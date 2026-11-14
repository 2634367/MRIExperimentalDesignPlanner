"""The report download (app/core/report.py): the zip, or report.xlsx alone.

The browser sends the tables, methods and figures it drew; the experiment
itself comes from the store, so the zip's experiment.json is what is saved,
not what the browser says. Anyone who can open the experiment -- an editor,
or a share link -- can download its report.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal

from msgspec import Meta
from starlette.requests import Request
from starlette.responses import Response

from app.apidocs import PUBLIC, route
from app.apidocs import Request as RequestType
from app.core import bundle, report
from app.core.report import MAX_FIGURES, MAX_TABLES, BadReportError
from app.core.security import actor_from
from app.core.db import Store
from app.models import experiments, scanner_cards, share_links
from app.models.experiments import NoSuchExperimentError
from app.models.share_links import ShareLinkInvalidError
from app.routes.experiments import NO_SUCH, ExperimentID
from app.routes.helpers import Refused, get_store
from app.routes.share import INVALID, Credential, zip_response

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
REPLY = "The report zip, or report.xlsx alone when only is xlsx, as an attachment"


class ReportBody(RequestType):
    """What the browser drew (static/js/report.js); app/core/report.py
    check_report checks the rest."""

    tables: Annotated[
        list[dict[str, Any]],
        Meta(description=f"At most {MAX_TABLES}: each {{id, title, columns, rows}}.",
             extra={"error": f"tables must be a list of at most {MAX_TABLES}"}),
    ]
    methods: Annotated[str, Meta(description="The methods text, as Markdown.")] = ""
    figures: Annotated[
        list[dict[str, Any]],
        Meta(description=f"At most {MAX_FIGURES}: each {{name, svg, png}}, png base64 and optional.",
             extra={"error": f"figures must be a list of at most {MAX_FIGURES}"}),
    ] = []
    only: Annotated[Literal["", "xlsx"], Meta(description="xlsx for report.xlsx alone; otherwise the whole zip.")] = ""


class ReportRequest(ReportBody, kw_only=True):
    experiment_id: ExperimentID


class SharedReportRequest(ReportBody, kw_only=True):
    credential: Credential


def _report(store: Store, experiment_id: str, user_id: int, body: dict) -> tuple[str, bytes, bool]:
    experiment = experiments.experiment_for(store, experiment_id, user_id)
    checked = report.check_report(body)
    return experiment.name, report.build(experiment.name, experiment.doc, checked, scanner_cards.used_by(store, experiment.doc)), checked.only_xlsx


def _shared_report(store: Store, body: dict) -> tuple[str, bytes, bool]:
    _, experiment = share_links.load_shared(store, body.get("credential"))
    checked = report.check_report(body)
    return experiment.name, report.build(experiment.name, experiment.doc, checked, scanner_cards.used_by(store, experiment.doc)), checked.only_xlsx


def _fields(body: ReportBody) -> dict[str, Any]:
    """The request as the dict check_report reads."""
    return {"tables": body.tables, "methods": body.methods, "figures": body.figures, "only": body.only}


def _response(name: str, data: bytes, only_xlsx: bool) -> Response:
    if not only_xlsx:
        return zip_response(name, data)
    filename = bundle.folder_name(name) + ".xlsx"
    return Response(data, media_type=XLSX, headers={"content-disposition": f'attachment; filename="{filename}"', "cache-control": "no-store"})


@route(
    "POST /api/experiments/{experiment_id}/report", summary="Download the report zip or report.xlsx",
    tag="Experiments", errors=(404,), reply_type="application/octet-stream", reply_description=REPLY,
    mcp_http="A document download: A file, not JSON: it goes over HTTP, with the same key.",
)
def download_report(request: Request, body: ReportRequest) -> Response:
    try:
        name, data, only_xlsx = _report(get_store(request), body.experiment_id, actor_from(request).user.id, _fields(body))
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    except BadReportError as refusal:
        raise Refused(400, str(refusal)) from None
    return _response(name, data, only_xlsx)


@route(
    "POST /api/share/report", summary="Download the report through a share link",
    tag="Share links", access=PUBLIC, errors=(404,), reply_type="application/octet-stream", reply_description=REPLY,
)
def shared_report(request: Request, body: SharedReportRequest) -> Response:
    try:
        name, data, only_xlsx = _shared_report(get_store(request), {**_fields(body), "credential": body.credential})
    except ShareLinkInvalidError:
        raise Refused(404, INVALID) from None
    except BadReportError as refusal:
        raise Refused(400, str(refusal)) from None
    return _response(name, data, only_xlsx)
