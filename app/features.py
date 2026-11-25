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
    accepts_url: bool = False       # input can be an audio/file link instead of an upload
    theme: str = "default"          # page accent, see .theme-* in style.css
    history_hint: str = "Search saved results…"
    batch: bool = False             # many files/links per run (see /api/features/<slug>/batch)
    input_template: str = "inputs/panel.html"
    scripts: list[str] = field(default_factory=list)   # extra page JS (loaded before feature.js)
    styles: list[str] = field(default_factory=list)    # extra page CSS
    portal_url: str | None = None   # hosted elsewhere for now: page embeds this portal

    @property
    def api(self) -> dict:
        return api_settings(self.env_prefix)

    @property
    def is_portal(self) -> bool:
        return bool(self.portal_url)

    @property
    def is_live(self) -> bool:
        from app.config import force_demo_mode
        return not self.is_portal and bool(self.api["url"]) and not force_demo_mode()

    @property
    def mode(self) -> str:
        if self.is_portal:
            return "portal"
        return "live" if self.is_live else "demo"

    @property
    def status_label(self) -> str:
        return {"portal": "Demo portal", "live": "Live API", "demo": "Demo data"}[self.mode]

    @property
    def href(self) -> str:
        return f"/features/{self.slug}"

    def public_dict(self) -> dict:
        """Safe representation for the frontend (never exposes API keys/URLs)."""
        return {
            "slug": self.slug,
            "name": self.name,
            "category": self.category,
            "tagline": self.tagline,
            "mode": self.mode,
            "url": self.href,
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
        history_hint="Search file, agent, customer, lead…",
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
        name="Agent Call Quality Check (QC)",
        short_name="Agent QC",
        category="Voice & Call Intelligence",
        icon="shield",
        tagline="Score every agent call against your quality and compliance standards.",
        description=(
            "Checks greeting, empathy, compliance, problem resolution and closing on "
            "every call, and gives each agent a scorecard with coaching tips."
        ),
        env_prefix="AGENT_QA",
        file_kind="recordings",
        # Runs on its own demo portal for now (embedded on the feature page). Remove
        # portal_url once the API and frontend are integrated here (mock data +
        # renderer already exist).
        portal_url="http://138.252.115.100:6042/",
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
    ),
    Feature(
        slug="call-transcription",
        name="Call Transcription",
        short_name="Transcription",
        category="Voice & Call Intelligence",
        icon="captions",
        tagline="Word-for-word, speaker-separated transcripts of any call, Bangla included.",
        description=(
            "Upload a call recording or paste a link to one and the AI writes down the whole "
            "conversation: every line timestamped and labelled Agent or Customer. Play the call "
            "and follow along line by line, search what was said, and export as text or subtitles."
        ),
        env_prefix="CALL_TRANSCRIPT",
        file_kind="recordings",
        file_required=True,
        accepts_url=True,
        theme="studio",
        run_label="Transcribe call",
        docs_file="call_transcription.md",
        history_hint="Search file, link, language or words spoken…",
        highlights=[
            "Agent / Customer speaker separation",
            "Timestamp on every line, synced with the audio",
            "Works with Bangla, English and mixed speech",
            "Upload a file or transcribe straight from a URL",
            "Export as text, per-speaker text or .srt subtitles",
        ],
        steps=[
            "Upload a recording or paste a direct link to one",
            "AI detects the language and separates the speakers",
            "Follow along with playback, search and export",
        ],
        use_cases=[
            {"title": "Record keeping", "text": "A searchable written record of every customer call."},
            {"title": "Quality & disputes", "text": "Check exactly what was promised, word for word."},
            {"title": "Data pipelines", "text": "Feed transcripts into CRMs, analytics and other AI tools."},
        ],
        processing_steps=["Fetching audio", "Detecting language", "Separating speakers", "Writing transcript"],
    ),
    Feature(
        slug="lead-finder",
        name="Lead Finder AI",
        short_name="Lead Finder",
        category="Sales Intelligence",
        icon="target",
        tagline="Scan 1 to 1,000 call recordings and pick out the callers worth following up.",
        description=(
            "Drop in a batch of call recordings (or links to them) and describe your business. "
            "The AI listens to every call and sorts it into Strong lead, Potential lead, Weak interest "
            "or Not a lead, with the keywords it heard, what the customer needs and why. "
            "Leave the criteria empty to use the built-in FedEx profile."
        ),
        env_prefix="LEAD_FINDER",
        file_kind="recordings",
        file_required=True,
        accepts_url=True,
        theme="radar",
        run_label="Find leads",
        docs_file="lead_finder.md",
        history_hint="Search file, keyword, business…",
        batch=True,
        input_template="inputs/lead_finder.html",
        scripts=["js/lead_view.js", "js/lead_input.js"],
        styles=["css/lead_finder.css"],
        highlights=[
            "1 to 1,000 calls per run, files and links mixed",
            "Strong / Potential / Weak / Not a lead for every call",
            "Your own keywords, business profile and exclusions",
            "Live progress board while calls are analyzed",
            "Lead board, searchable call table and CSV export",
        ],
        steps=[
            "Add call recordings: upload files, paste links or pick samples",
            "Describe what counts as a lead (or keep the FedEx default)",
            "AI analyzes every call and ranks the leads",
        ],
        use_cases=[
            {"title": "Sales teams", "text": "Find buyers hidden in yesterday's inbound calls."},
            {"title": "Call centers", "text": "Pass sales opportunities from support calls to sales."},
            {"title": "Managers", "text": "See how many real opportunities a campaign produced."},
        ],
        processing_steps=["Uploading calls", "Listening", "Matching lead criteria", "Ranking leads"],
    ),
    Feature(
        slug="crm-ai-planner",
        name="CRM AI Planner",
        short_name="AI Planner",
        category="Sales Intelligence",
        icon="calendar",
        tagline="Turns every task, follow-up, note, call and message in the CRM into today's plan.",
        description=(
            "A team of AI agents reads the user's whole CRM: tasks, follow-ups, notes, call "
            "transcripts and emails/messages. It builds a time-blocked plan for the day, flags what "
            "must not slip, spots leads going cold, tracks promises made on calls and drafts the "
            "points for every reply that's waiting."
        ),
        env_prefix="CRM_PLANNER",
        file_kind="crm",
        run_label="Plan my day",
        docs_file="crm_planner.md",
        theme="planner",
        history_hint="Search user, industry, summary…",
        input_template="inputs/crm_planner.html",
        scripts=["js/planner_view.js", "js/planner_input.js"],
        styles=["css/planner.css"],
        highlights=[
            "Time-blocked plan for the working day, conflicts flagged",
            "\"Must not slip\" items with the cost of missing them",
            "Leads at risk with evidence from calls, notes and messages",
            "Promises made on calls, and whether a task covers them",
            "Replies waiting on you, with suggested talking points",
        ],
        steps=[
            "Pick a demo CRM (4 industries) or load your own CRM JSON",
            "Call, conversation and task agents read every record",
            "A planner agent merges them into one plan for today",
        ],
        use_cases=[
            {"title": "Sales reps", "text": "Start the day knowing exactly what to do first and what can wait."},
            {"title": "Account managers", "text": "Never miss a promise made on a call or an unhappy customer."},
            {"title": "Team leads", "text": "See which deals are at risk before they're lost."},
        ],
        processing_steps=["Reading CRM records", "Analyzing calls", "Reading conversations",
                          "Checking tasks & follow-ups", "Building today's plan"],
    ),
    Feature(
        slug="customer-support-chatbot",
        name="Customer Support Chatbot",
        short_name="Support Chatbot",
        category="Customer Experience",
        icon="chat",
        tagline="An AI assistant that answers customer questions around the clock.",
        description=(
            "A chat assistant for your website or app that answers customer questions "
            "instantly, any time of day, so your support team can focus on the cases "
            "that need a person."
        ),
        env_prefix="SUPPORT_CHATBOT",
        # Runs on its own demo portal for now (embedded on the feature page).
        portal_url="http://138.252.115.100:6040/",
        highlights=[
            "Instant answers to customer questions",
            "Available 24/7",
            "Natural, conversational replies",
        ],
        steps=[
            "Type a question in the chat window",
            "The AI assistant understands what the customer needs",
            "It replies in seconds",
        ],
        use_cases=[
            {"title": "Customer support", "text": "Answer common questions without waiting for an agent."},
            {"title": "Websites & apps", "text": "Help visitors find what they need, any time."},
            {"title": "Support teams", "text": "Reduce repetitive tickets and calls."},
        ],
    ),
]

FEATURES_BY_SLUG = {f.slug: f for f in FEATURES}


def features_by_category() -> dict[str, list[Feature]]:
    grouped: dict[str, list[Feature]] = {}
    for f in FEATURES:
        grouped.setdefault(f.category, []).append(f)
    return grouped
