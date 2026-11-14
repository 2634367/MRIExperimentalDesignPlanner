"""Running a design: download a PsychoPy bundle, or start PsychoPy here.

Both take run plans the browser compiled (static/js/compile.js) and check
them with app.models.plans before anything touches the disk. The bundle works
for anyone who can open the experiment. Launching starts a process on this
machine, so it needs a browser session (never an API key) and is refused
unless app/core/psychopy.py says this server may do it.
"""
from __future__ import annotations

from typing import Annotated, Any, ClassVar, Literal

from msgspec import UNSET, Meta, UnsetType
from starlette.requests import Request
from starlette.responses import Response

from app.apidocs import PATH, QUERY, SESSION_ONLY, Reply, route
from app.apidocs import Request as RequestType
from app.apidocs.route import reply_response
from app.core import bundle, psychopy
from app.core.db import Store
from app.core.security import actor_from
from app.models import experiments, results, seen
from app.models.experiments import NoSuchExperimentError
from app.models.plans import MAX_PLANS, BadPlanError, check_plans
from app.routes.experiments import NO_SUCH, ExperimentPath
from app.routes.helpers import DateTime, Refused, get_config, get_store
from app.routes.media import MissingMediaError, files_for_plans
from app.routes.share import zip_response

TAG = "Experiments"

# Why the file and runner routes stay HTTP, as the old spec said (x-mcp-http).
FILE_HTTP = "A zip download: A file, not JSON: it goes over HTTP, with the same key."
RUNNER_HTTP = "The PsychoPy runner's exchange with the designer (runner/), over HTTP with the same key."

Plans = Annotated[
    list[dict[str, Any]],
    Meta(description=f"1 to {MAX_PLANS} run plans (fmri-run-plan/1), as static/js/compile.js makes them.",
         extra={"error": f"send 1 to {MAX_PLANS} run plans"}),
]


# -- whether PsychoPy can run here ---------------------------------------------


class StatusRequest(RequestType):
    refresh: Annotated[bool, QUERY, Meta(description="Look again rather than using the last answer.")] = False


class StatusReply(Reply):
    available: bool
    reason: Annotated[str, Meta(description="Why not, when it cannot: switched_off, container, not_local, no_runner, ...")]
    python: str | UnsetType = UNSET
    psychopy_version: str | UnsetType = UNSET
    python_version: str | UnsetType = UNSET
    source: str | UnsetType = UNSET
    keyboard: str | UnsetType = UNSET


@route(
    "GET /api/psychopy", summary="Can this server run PsychoPy",
    tag=TAG,
    description="Whether this server can start PsychoPy runs itself, and why not if it cannot. refresh looks "
    "again rather than using the last answer.",
    mcp="psychopy_status", read_only=True,  # feature:mcp
)
def get_status(request: Request, body: StatusRequest) -> StatusReply:
    return StatusReply(**psychopy.status(get_config(request), body.refresh).row())


# -- the bundle ----------------------------------------------------------------


class BundleRequest(ExperimentPath):
    plans: Plans


def _bundle(store: Store, storage_dir, experiment_id: str, user_id: int, plans: object) -> tuple[str, bytes]:
    experiment = experiments.experiment_for(store, experiment_id, user_id)
    checked = check_plans(plans)
    files = files_for_plans(store, storage_dir, experiment.id, checked)
    return experiment.name, bundle.build(experiment.name, checked, files)


@route(
    "POST /api/experiments/{experiment_id}/bundle", summary="Download the PsychoPy bundle for run plans",
    tag=TAG, errors=(404,), reply_type="application/zip", reply_description="The bundle, as an attachment",
    mcp_http=FILE_HTTP,
)
def download_bundle(request: Request, body: BundleRequest) -> Response:
    try:
        name, data = _bundle(
            get_store(request), get_config(request).storage_dir,
            body.experiment_id, actor_from(request).user.id, body.plans,
        )
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    except (BadPlanError, MissingMediaError) as refusal:
        raise Refused(400, str(refusal)) from None
    return zip_response(name, data)


# -- launching PsychoPy here ---------------------------------------------------


class Launch(Reply):
    """A PsychoPy launch on this machine."""

    api_name: ClassVar[str] = "PsychoPyLaunch"
    id: str
    label: str
    running: bool
    exit_code: int | None
    stopped: bool
    started_at: DateTime
    ended_at: DateTime | None
    folder: str
    log: Annotated[list[str], Meta(description="The last lines of the runner's log.")]


class LaunchRequest(ExperimentPath):
    plans: Plans
    label: Annotated[str, Meta(description="What to call the launch; the experiment's name when empty. Cut to 200 characters.")] = ""
    scanner: Annotated[Literal["wait", "simulate", "none"], Meta(extra={"error": "scanner must be wait, simulate or none"})] = "wait"
    windowed: bool = False
    screen: Annotated[
        int, Meta(ge=0, le=psychopy.MAX_SCREEN, extra={"error": f"screen must be a number from 0 to {psychopy.MAX_SCREEN}"}),
    ] = 0
    debug: bool = False
    flip: Annotated[
        Literal["none", "horizontal", "vertical", "both"],
        Meta(extra={"error": "flip must be none, horizontal, vertical or both"}),
    ] = "none"


def _launch(store: Store, cfg, user_id: int, body: LaunchRequest) -> dict:
    experiment = experiments.experiment_for(store, body.experiment_id, user_id)
    checked = check_plans(body.plans)
    files = files_for_plans(store, cfg.storage_dir, experiment.id, checked)
    launch = psychopy.start(
        cfg, checked, files, user_id, (body.label or experiment.name)[:200],
        body.scanner, body.windowed, body.screen, body.debug,
        on_end=lambda folder: _collect(store, experiment.id, folder), flip=body.flip,
    )
    return launch.row()


def _collect(store: Store, experiment_id: str, folder) -> None:
    """What a finished launch left: what was seen, and how each run went.
    One failing does not stop the other."""
    try:
        seen.add_folder(store, experiment_id, folder)
    finally:
        results.add_folder(store, experiment_id, folder)


@route(
    "POST /api/experiments/{experiment_id}/launch", summary="Start PsychoPy on this machine",
    tag=TAG, access=SESSION_ONLY, status=201, errors=(404, 409),
    description="Runs the plans in PsychoPy here, where app/core/psychopy.py says this server may (a 503 says "
    "why not). One launch at a time: a 409 while another is running.",
    reply_description="Created",
)
def launch(request: Request, body: LaunchRequest) -> Launch:
    try:
        row = _launch(get_store(request), get_config(request), actor_from(request).user.id, body)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    except (BadPlanError, MissingMediaError, ValueError) as refusal:
        raise Refused(400, str(refusal)) from None
    except psychopy.LaunchUnavailableError as refusal:
        raise Refused(503, str(refusal)) from None
    except psychopy.AlreadyRunningError as refusal:
        raise Refused(409, str(refusal)) from None
    return Launch(**row)


class LaunchPath(RequestType):
    launch_id: Annotated[str, PATH, Meta(description="The launch's id, from POST /api/experiments/{experiment_id}/launch or GET /api/launches/latest.")]


@route(
    "GET /api/launches/latest", summary="The latest PsychoPy launch",
    tag=TAG, access=SESSION_ONLY,
    description="Your most recent launch on this machine, or null if there is none.",
)
def latest_launch(request: Request) -> Launch | None:
    found = psychopy.latest(actor_from(request).user.id)
    if found is None:
        # A declared route that returns None sends no body; this one has
        # always answered JSON null.
        return reply_response(None)
    return Launch(**found.row())


@route(
    "GET /api/launches/{launch_id}", summary="A PsychoPy launch's state",
    tag=TAG, access=SESSION_ONLY, errors=(404,),
)
def get_launch(request: Request, body: LaunchPath) -> Launch:
    found = psychopy.get(body.launch_id, actor_from(request).user.id)
    if found is None:
        raise Refused(404, "no such launch")
    return Launch(**found.row())


@route(
    "POST /api/launches/{launch_id}/stop", summary="Stop a PsychoPy launch",
    tag=TAG, access=SESSION_ONLY, errors=(404,),
)
def stop_launch(request: Request, body: LaunchPath) -> Launch:
    stopped = psychopy.stop(body.launch_id, actor_from(request).user.id)
    if stopped is None:
        raise Refused(404, "no such launch")
    return Launch(**stopped.row())


# -- what was seen, and how runs went -------------------------------------------


class SeenRequest(ExperimentPath):
    participant: Annotated[str, Meta(description="The participant's label.")] = ""


class SeenReply(Reply):
    items: Annotated[list[str], Meta(description="The ids of the list items this participant has been shown.")]
    runs: Annotated[int, Meta(description="How many runs of theirs were brought back.")]
    highest_visit: int


@route(
    "POST /api/experiments/{experiment_id}/seen", summary="What a participant has been shown",
    tag=TAG, errors=(404,),
    description="A POST so the participant's label stays out of URLs and access logs.",
    mcp_http=RUNNER_HTTP,
)
def read_seen(request: Request, body: SeenRequest) -> SeenReply:
    try:
        experiment = experiments.experiment_for(get_store(request), body.experiment_id, actor_from(request).user.id)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    return SeenReply(**seen.read(get_store(request), experiment.id, body.participant))


class AddSeenRequest(ExperimentPath):
    runs: Annotated[
        list[dict[str, Any]],
        Meta(description="Run records brought back from a bundle, trimmed to what app/models/seen.py summarise keeps.",
             extra={"error": f"send at most {seen.RUNS_PER_REQUEST_MAX} runs"}),
    ]


class AddedReply(Reply):
    added: Annotated[int, Meta(description="How many were new. Records from another experiment are skipped.")]


@route(
    "POST /api/experiments/{experiment_id}/seen/add", summary="Add run records brought back from a bundle",
    tag=TAG, errors=(404,),
    description="Run records brought back from a bundle, trimmed by the run dialog to what seen.summarise keeps. "
    "One already recorded changes nothing.",
    mcp_http=RUNNER_HTTP,
)
def add_seen(request: Request, body: AddSeenRequest) -> AddedReply:
    store = get_store(request)
    try:
        experiment = experiments.experiment_for(store, body.experiment_id, actor_from(request).user.id)
        added = seen.add_runs(store, experiment.id, body.runs)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    except seen.BadRunError as refusal:
        raise Refused(400, str(refusal)) from None
    return AddedReply(added=added)


class ResultsReply(Reply):
    runs: Annotated[list[dict[str, Any]], Meta(description="Every run brought back, newest first, each with its verdict.")]


@route(
    "GET /api/experiments/{experiment_id}/results", summary="How each run brought back went",
    tag=TAG, errors=(404,),
    description="How every run brought back went, newest first, each with a verdict.",
    mcp_http=RUNNER_HTTP,
)
def read_results(request: Request, body: ExperimentPath) -> ResultsReply:
    store = get_store(request)
    try:
        experiment = experiments.experiment_for(store, body.experiment_id, actor_from(request).user.id)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    return ResultsReply(runs=results.read(store, experiment.id))


class AddResultsRequest(ExperimentPath):
    records: Annotated[
        list[dict[str, Any]],
        Meta(description="Run records brought back from a bundle, trimmed to what app/models/results.py summarise reads.",
             extra={"error": f"send at most {results.RECORDS_PER_REQUEST_MAX} run records"}),
    ]


@route(
    "POST /api/experiments/{experiment_id}/results/add", summary="Add run records for the results screen",
    tag=TAG, errors=(404,),
    description="Run records brought back from a bundle, trimmed by the run dialog to what results.summarise reads.",
    mcp_http=RUNNER_HTTP,
)
def add_results(request: Request, body: AddResultsRequest) -> AddedReply:
    store = get_store(request)
    try:
        experiment = experiments.experiment_for(store, body.experiment_id, actor_from(request).user.id)
        added = results.add_records(store, experiment.id, body.records)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    except results.BadRecordError as refusal:
        raise Refused(400, str(refusal)) from None
    return AddedReply(added=added)


class RemoveResultRequest(ExperimentPath):
    run: Annotated[str, Meta(description="The run's name, as GET .../results gives it.")]


class RemovedReply(Reply):
    removed: bool


@route(
    "POST /api/experiments/{experiment_id}/results/remove", summary="Forget one run's results",
    tag=TAG, errors=(404,),
    description="For a record brought back by mistake. The files themselves are untouched.",
    mcp_http=RUNNER_HTTP,
)
def remove_result(request: Request, body: RemoveResultRequest) -> RemovedReply:
    store = get_store(request)
    try:
        experiment = experiments.experiment_for(store, body.experiment_id, actor_from(request).user.id)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    if not results.remove(store, experiment.id, body.run):
        raise Refused(404, "no such run")
    return RemovedReply(removed=True)
