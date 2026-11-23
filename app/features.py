"""
Feature registry - the single source of truth for every AI feature shown
on the platform. Adding a new feature = add one entry to FEATURES, set its
env vars, write an adapter (services/api_client.py) and a renderer
(static/js/renderers.js). API contracts are documented in /api_docs.
"""
from dataclasses import dataclass, field

from app.config import api_settings


@dataclass
class Feature:
    slug: str                       # URL: /features/<slug>
    name: str
    short_name: str
    category: str
    icon: str                       # icon key, see templates/partials/icons.html
    tagline: str
    description: str
    env_prefix: str                 # reads <PREFIX>_API_URL / <PREFIX>_API_KEY
    file_kind: str | None = None    # "recordings" | "crm" | None (no file input)
    file_required: bool = False
    form_fields: list[dict] = field(default_factory=list)
    run_label: str = "Run analysis"
    docs_file: str | None = None    # file name inside /api_docs
    highlights: list[str] = field(default_factory=list)
    steps: list[str] = field(default_factory=list)
    use_cases: list[dict] = field(default_factory=list)
    processing_steps: list[str] = field(default_factory=list)

    @property
    def api(self) -> dict:
        return api_settings(self.env_prefix)

    @property
    def is_live(self) -> bool:
        from app.config import force_demo_mode
        return bool(self.api["url"]) and not force_demo_mode()

    @property
    def mode(self) -> str:
        return "live" if self.is_live else "demo"

    def public_dict(self) -> dict:
        """Safe representation for the frontend (never exposes API keys/URLs)."""
        return {
            "slug": self.slug,
            "name": self.name,
            "category": self.category,
            "tagline": self.tagline,
            "mode": self.mode,
        }


# Form field schema: {name, label, type: text|select|textarea, options: [[value, label]],
#                     default, required, placeholder, help, full (span 2 columns)}
FEATURES: list[Feature] = [
    Feature(
        slug="call-recording-analysis",
        name="Call Recording Analysis",
        short_name="Call Analysis",
        category="Voice & Call Intelligence",
        icon="waveform",
        tagline="Summary, sentiment, outcome and action items from any call recording.",
        description=(
            "Upload a sales or support call and the AI returns a structured analysis: "
            "summary, customer sentiment, call outcome, pain points, objections, "
            "products discussed, action items and follow-up needs, ready to save "
            "against the call record in your CRM."
        ),
        env_prefix="CALL_ANALYSIS",
        file_kind="recordings",
        file_required=True,
        run_label="Analyze call",
        docs_file="recording_analysis.md",
        form_fields=[
            {"name": "language", "label": "Summary language", "type": "select", "required": True,
             "options": [["en", "English"], ["bn", "Bangla"]], "default": "en",
             "help": "Language of the analysis output (not the audio)."},
            {"name": "call_direction", "label": "Call direction", "type": "select",
             "options": [["", "Not specified"], ["outbound", "Outbound"], ["inbound", "Inbound"]]},
            {"name": "agent_name", "label": "Agent name", "type": "text", "placeholder": "e.g. Rahim"},
            {"name": "customer_name", "label": "Customer name", "type": "text", "placeholder": "e.g. Karim"},
            {"name": "deal_or_lead_id", "label": "Deal / Lead ID", "type": "text", "placeholder": "e.g. LD-1042"},
            {"name": "product_or_service", "label": "Product / Service", "type": "text",
             "placeholder": "e.g. Health package"},
        ],
        highlights=[
            "Concise call summary",
            "Customer sentiment and call outcome",
            "Pain points, objections and products discussed",
            "Action items and follow-up recommendation",
            "Output in English or Bangla",
        ],
        steps=[
            "Upload the call recording (mp3, wav, ogg, m4a…)",
            "Optionally add agent, customer and deal context",
            "AI listens to the call and returns a structured analysis",
        ],
        use_cases=[
            {"title": "Sales teams", "text": "Log every call in the CRM automatically with outcome and next steps."},
            {"title": "Customer support", "text": "Spot pain points and unhappy customers early."},
            {"title": "Managers", "text": "Review many calls quickly without listening to them."},
        ],
        processing_steps=[
            "Uploading recording",
            "Listening to the call",
            "Extracting insights",
            "Preparing analysis",
        ],
    ),
    Feature(
        slug="agent-quality-check",
        name="Call Center Agent Quality Check",
        short_name="Agent QA",
        category="Voice & Call Intelligence",
        icon="shield",
        tagline="Score every agent call against your quality and compliance standards.",
        description=(
            "Checks greeting, empathy, compliance, problem resolution and closing on "
            "every call, and gives each agent a scorecard with coaching tips."
        ),
        env_prefix="AGENT_QA",
        file_kind="recordings",
        file_required=True,
        run_label="Check quality",
        highlights=[
            "Weighted quality scorecard",
            "Compliance and script adherence checks",
            "Coaching recommendations with evidence",
        ],
        steps=["Upload an agent call", "AI evaluates it against the QA scorecard", "Review scores and coaching tips"],
        use_cases=[
            {"title": "Contact centers", "text": "Review every call for QA instead of a small sample."},
            {"title": "Team leads", "text": "Coach agents with objective, evidence-based feedback."},
            {"title": "Compliance", "text": "Find missing disclosures automatically."},
        ],
        processing_steps=["Uploading recording", "Transcribing", "Scoring against criteria", "Preparing feedback"],
    ),
    Feature(
        slug="call-recording-transcript",
        name="Call Recording Transcript",
        short_name="Transcript",
        category="Voice & Call Intelligence",
        icon="document",
        tagline="Speaker-labelled, timestamped transcripts of call recordings.",
        description=(
            "Converts call recordings into searchable transcripts with speaker labels "
            "and timestamps. Click a line to play that part of the audio."
        ),
        env_prefix="CALL_TRANSCRIPT",
        file_kind="recordings",
        file_required=True,
        run_label="Transcribe",
        highlights=["Speaker separation", "Timestamps synced with audio", "Search, copy and download"],
        steps=["Upload a recording", "AI transcribes and separates speakers", "Search, play back and export"],
        use_cases=[
            {"title": "Record keeping", "text": "Searchable text records of customer calls."},
            {"title": "Training", "text": "Use real conversations for training material."},
            {"title": "Data pipelines", "text": "Feed transcripts to CRMs and analytics tools."},
        ],
        processing_steps=["Uploading recording", "Detecting speakers", "Transcribing speech", "Aligning timestamps"],
    ),
    Feature(
        slug="potential-lead-finder",
        name="Potential Lead Finder",
        short_name="Lead Finder",
        category="Sales Intelligence",
        icon="target",
        tagline="Find and rank the prospects most likely to buy.",
        description=(
            "Scans CRM data and market signals to find high-intent prospects, scores "
            "them by fit and buying intent and explains why each one is worth contacting."
        ),
        env_prefix="LEAD_FINDER",
        file_kind="crm",
        file_required=False,
        run_label="Find leads",
        form_fields=[
            {"name": "industry", "label": "Industry", "type": "select",
             "options": [["", "Any"]] + [[x, x] for x in [
                 "Telecommunications", "Insurance", "Software", "Healthcare", "E-commerce",
                 "Financial Services", "Real Estate", "Education", "Logistics", "Manufacturing"]]},
            {"name": "location", "label": "Location", "type": "text", "placeholder": "e.g. Dhaka"},
            {"name": "company_size", "label": "Company size", "type": "select",
             "options": [["", "Any"], ["1-50", "1-50"], ["51-200", "51-200"],
                         ["201-1000", "201-1000"], ["1000+", "1000+"]]},
            {"name": "limit", "label": "Number of leads", "type": "select",
             "options": [["5", "5"], ["8", "8"], ["10", "10"]], "default": "8"},
            {"name": "product", "label": "What are you selling?", "type": "textarea", "full": True,
             "placeholder": "e.g. AI call center analytics"},
        ],
        highlights=["Lead scoring (0-100)", "Reasons for each recommendation", "Suggested next action"],
        steps=["Describe your ideal customer or upload CRM data", "AI scores fit and intent", "Get a ranked lead list"],
        use_cases=[
            {"title": "B2B sales", "text": "Focus SDR time on accounts most likely to convert."},
            {"title": "Marketing", "text": "Build precise campaign audiences."},
            {"title": "Agencies", "text": "Find prospects in a region or vertical in minutes."},
        ],
        processing_steps=["Reading CRM records", "Enriching signals", "Scoring fit and intent", "Ranking leads"],
    ),
]

FEATURES_BY_SLUG = {f.slug: f for f in FEATURES}


def features_by_category() -> dict[str, list[Feature]]:
    grouped: dict[str, list[Feature]] = {}
    for f in FEATURES:
        grouped.setdefault(f.category, []).append(f)
    return grouped
