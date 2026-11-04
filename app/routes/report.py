"""The report download (app/core/report.py): the zip, or report.xlsx alone.

The browser sends the tables, methods and figures it drew; the experiment
itself comes from the store, so the zip's experiment.json is what is saved,
not what the browser says. Anyone who can open the experiment -- an editor,
or a share link -- can download its report.
"""
from __future__ import annotations

from starlette.requests import Request
from starlette.responses import Response

from app.core import bundle, report
from app.core.db import Store
from app.core.report import BadReportError
from app.core.security import actor_from, check_csrf
from app.models import experiments, share_links
from app.models.experiments import NoSuchExperimentError
from app.models.share_links import ShareLinkInvalidError
from app.routes.helpers import bad_request, forbidden, get_store, not_found, read_json, run
from app.routes.share import INVALID, zip_response

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _report(store: Store, experiment_id: str, user_id: int, body: dict) -> tuple[str, bytes, bool]:
    experiment = experiments.experiment_for(store, experiment_id, user_id)
    checked = report.check_report(body)
    return experiment.name, report.build(experiment.name, experiment.doc, checked), checked.only_xlsx


def _shared_report(store: Store, body: dict) -> tuple[str, bytes, bool]:
    _, experiment = share_links.load_shared(store, body.get("credential"))
    checked = report.check_report(body)
    return experiment.name, report.build(experiment.name, experiment.doc, checked), checked.only_xlsx


def _response(name: str, data: bytes, only_xlsx: bool) -> Response:
    if not only_xlsx:
        return zip_response(name, data)
    filename = bundle.folder_name(name) + ".xlsx"
    return Response(data, media_type=XLSX, headers={"content-disposition": f'attachment; filename="{filename}"', "cache-control": "no-store"})


async def download_report(request: Request) -> Response:
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    if not check_csrf(request, body.get("csrf_token")):
        return forbidden("invalid csrf token")
    try:
        name, data, only_xlsx = await run(_report, get_store(request), request.path_params["experiment_id"], actor_from(request).user.id, body)
    except NoSuchExperimentError:
        return not_found("no such experiment")
    except BadReportError as refusal:
        return bad_request(str(refusal))
    return _response(name, data, only_xlsx)


async def shared_report(request: Request) -> Response:
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    try:
        name, data, only_xlsx = await run(_shared_report, get_store(request), body)
    except ShareLinkInvalidError:
        return not_found(INVALID)
    except BadReportError as refusal:
        return bad_request(str(refusal))
    return _response(name, data, only_xlsx)
