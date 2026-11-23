"""
Database tables - one table per AI feature.

Every table shares the columns in `RunMixin` (who/when/what file/full JSON
response) and adds its own searchable columns pulled out of the response.
The full API response is always kept in `response`, so the frontend can
re-render a saved result exactly like a fresh one.

Adding a feature:
  1. create `class XxxRun(RunMixin, Base)` with __tablename__ + its columns
  2. implement `extract()` (response -> columns) and `card()` (history list)
  3. register it in HISTORY_MODELS under the feature slug
The table is created automatically on the next start.
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def cut(value, length: int):
    """Trim strings so they always fit their VARCHAR column."""
    if value is None:
        return None
    value = str(value).strip()
    return value[:length] or None


class RunMixin:
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"),
                                    primary_key=True, autoincrement=True, sort_order=-1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True,
                                                 comment="UTC", sort_order=-1)
    mode: Mapped[str] = mapped_column(String(10), comment="live | demo", sort_order=-1)
    elapsed_ms: Mapped[int | None] = mapped_column(Integer, sort_order=-1)
    source: Mapped[str] = mapped_column(String(10), default="none",
                                        comment="upload | sample | none", sort_order=-1)
    file_name: Mapped[str | None] = mapped_column(String(255), sort_order=-1)
    file_path: Mapped[str | None] = mapped_column(String(500),
                                                  comment="stored upload, relative to STORAGE_DIR", sort_order=-1)
    file_size: Mapped[int | None] = mapped_column(BigInteger, sort_order=-1)
    content_type: Mapped[str | None] = mapped_column(String(100), sort_order=-1)
    params: Mapped[dict | None] = mapped_column(JSON, comment="form inputs sent to the API", sort_order=1)
    response: Mapped[dict | None] = mapped_column(JSON, comment="full AI API response", sort_order=1)

    # --- per-feature hooks -------------------------------------------------
    search_columns: tuple[str, ...] = ("file_name",)

    @classmethod
    def extract(cls, params: dict, data: dict) -> dict:
        return {}

    def card(self) -> dict:
        """Compact info shown in the history list."""
        return {"title": self.file_name or f"Run #{self.id}", "subtitle": None, "tags": []}

    def list_item(self) -> dict:
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat(timespec="seconds") + "Z",
            "mode": self.mode,
            "source": self.source,
            "file_name": self.file_name,
            "elapsed_ms": self.elapsed_ms,
            **self.card(),
        }


# =====================================================================
# Call Recording Analysis
# =====================================================================
SENTIMENT_TONES = {"positive": "green", "negative": "red", "neutral": "blue", "mixed": "amber"}


class CallAnalysisRun(RunMixin, Base):
    __tablename__ = "call_analysis_runs"
    __table_args__ = {"comment": "Call Recording Analysis results",
                      "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}

    # request
    language: Mapped[str | None] = mapped_column(String(8))
    agent_name: Mapped[str | None] = mapped_column(String(150))
    customer_name: Mapped[str | None] = mapped_column(String(150))
    call_direction: Mapped[str | None] = mapped_column(String(16))
    deal_or_lead_id: Mapped[str | None] = mapped_column(String(100), index=True)
    product_or_service: Mapped[str | None] = mapped_column(String(255))
    # response highlights
    customer_sentiment: Mapped[str | None] = mapped_column(String(32), index=True)
    call_outcome: Mapped[str | None] = mapped_column(Text)
    follow_up_required: Mapped[bool | None] = mapped_column(Boolean)
    summary: Mapped[str | None] = mapped_column(Text)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    total_tokens: Mapped[int | None] = mapped_column(Integer)
    audio_tokens: Mapped[int | None] = mapped_column(Integer)

    search_columns = ("file_name", "agent_name", "customer_name", "deal_or_lead_id",
                      "product_or_service", "customer_sentiment")

    @classmethod
    def extract(cls, params: dict, data: dict) -> dict:
        a = (data or {}).get("analysis") or {}
        t = (data or {}).get("token_usage") or {}
        num = lambda v: v if isinstance(v, int) else None  # noqa: E731
        follow = a.get("follow_up_required")
        return {
            "language": cut(data.get("language") or params.get("language"), 8),
            "agent_name": cut(params.get("agent_name"), 150),
            "customer_name": cut(params.get("customer_name"), 150),
            "call_direction": cut(params.get("call_direction"), 16),
            "deal_or_lead_id": cut(params.get("deal_or_lead_id"), 100),
            "product_or_service": cut(params.get("product_or_service"), 255),
            "customer_sentiment": cut(str(a.get("customer_sentiment") or "").lower(), 32),
            "call_outcome": a.get("call_outcome") or None,
            "follow_up_required": follow if isinstance(follow, bool) else None,
            "summary": a.get("summary") or None,
            "input_tokens": num(t.get("input_tokens")),
            "output_tokens": num(t.get("output_tokens")),
            "total_tokens": num(t.get("total_tokens")),
            "audio_tokens": num(t.get("audio_tokens")),
        }

    def card(self) -> dict:
        tags = []
        if self.customer_sentiment:
            tags.append({"text": self.customer_sentiment.capitalize(),
                         "tone": SENTIMENT_TONES.get(self.customer_sentiment, "")})
        if self.language:
            tags.append({"text": self.language.upper(), "tone": ""})
        if self.follow_up_required:
            tags.append({"text": "Follow-up", "tone": "red"})
        people = " ↔ ".join(p for p in (self.agent_name, self.customer_name) if p)
        return {
            "title": self.file_name or f"Call #{self.id}",
            "subtitle": self.call_outcome or people or None,
            "tags": tags,
        }


# feature slug -> table model. Features not listed here aren't saved yet.
HISTORY_MODELS: dict[str, type[RunMixin]] = {
    "call-recording-analysis": CallAnalysisRun,
}
