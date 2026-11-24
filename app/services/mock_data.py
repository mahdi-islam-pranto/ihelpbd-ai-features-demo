"""
Realistic mock responses used in DEMO mode (when an API URL isn't configured).
These also document the response shape each frontend renderer expects.
"""
import asyncio
import random

# One shared sample call so Transcript, Analysis and QA tell a consistent story.
SAMPLE_CALL = [
    ("Agent", 0.0, 6.2, "Thank you for calling BrightNet Communications, my name is Sarah. How can I help you today?"),
    ("Customer", 6.8, 14.5, "Hi Sarah. I just got my bill and it's almost forty dollars higher than usual. I'm honestly pretty frustrated."),
    ("Agent", 15.0, 21.4, "I completely understand, an unexpected charge is never nice. Let me look into that for you right away."),
    ("Agent", 21.9, 27.3, "Can I please verify your account with your full name and the last four digits of your phone number?"),
    ("Customer", 28.0, 33.1, "Sure, it's Michael Turner, and the last four are 4821."),
    ("Agent", 33.8, 43.6, "Thank you, Michael. I can see a one-time equipment fee of thirty-nine ninety-nine was added after your router replacement last month."),
    ("Customer", 44.2, 51.0, "But the technician told me that replacement was free because my old router was faulty."),
    ("Agent", 51.6, 60.2, "You're right, faulty equipment replacements are covered. That fee was applied in error, and I'm removing it from your account now."),
    ("Customer", 60.9, 64.3, "Oh, okay. That's a relief, thank you."),
    ("Agent", 65.0, 75.8, "You're welcome. The credit will show on your next statement. While I have you, I noticed you're often close to your data limit. Would you like to hear about our unlimited plan?"),
    ("Customer", 76.4, 80.2, "Maybe. How much more would that cost?"),
    ("Agent", 80.9, 92.5, "It's just ten dollars more per month, and for the first three months it's the same price as your current plan, so you can try it risk-free."),
    ("Customer", 93.1, 98.0, "That actually sounds good. Let's do it, as long as I can cancel if I don't like it."),
    ("Agent", 98.6, 108.4, "Absolutely, you can switch back anytime with no penalty. I've upgraded your plan, and you'll get a confirmation email within the hour."),
    ("Agent", 109.0, 114.2, "Is there anything else I can help you with today?"),
    ("Customer", 114.8, 118.6, "No, that's everything. You've been really helpful, thanks Sarah."),
    ("Agent", 119.1, 124.0, "My pleasure, Michael. Thank you for choosing BrightNet, have a wonderful day!"),
]


async def _simulate_latency(lo: float = 1.6, hi: float = 2.8):
    await asyncio.sleep(random.uniform(lo, hi))


def _transcript(params: dict, filename: str | None = None) -> dict:
    """Same shape as the live /transcribe API (api_docs/call_transcription.md)."""
    mmss = lambda sec: f"{int(sec) // 60:02d}:{int(sec) % 60:02d}"  # noqa: E731
    segments = [{"speaker": s, "start": mmss(a), "text": t} for s, a, _b, t in SAMPLE_CALL]
    by = lambda who: "\n".join(f"[{x['start']}] {x['text']}" for x in segments if x["speaker"] == who)  # noqa: E731
    url = params.get("audio_url")
    return {
        "audio_url": url,
        "file_name": filename or (url.rsplit("/", 1)[-1] if url else "demo-call.wav"),
        "mime_type": "audio/wav",
        "size_bytes": 1_984_512,
        "duration_seconds": SAMPLE_CALL[-1][2],
        "model": "demo",
        "language": "English",
        "segments": segments,
        "transcript": {"agent": by("Agent"), "customer": by("Customer")},
        "usage": {"input_tokens": 4210, "audio_input_tokens": 3770, "text_input_tokens": 440,
                  "output_tokens": 812, "thinking_tokens": 0, "total_tokens": 5022, "model_calls": 1,
                  "input_cost_usd": 0.001852, "output_cost_usd": 0.001218, "total_cost_usd": 0.00307},
        "processing_seconds": 6.4,
    }


def _analysis(params: dict) -> dict:
    """Same shape as the live /analyze-call API (api_docs/recording_analysis.md)."""
    return {
        "language": params.get("language") or "en",
        "analysis": {
            "summary": (
                "The customer called about an unexpected $39.99 charge on their bill. The agent "
                "verified the account and found an equipment fee applied in error after a free "
                "router replacement, and removed it. The agent then offered the Unlimited Data "
                "plan with a 3-month price-match promotion, which the customer accepted on the "
                "condition that they can cancel anytime. The call ended with the customer satisfied."
            ),
            "keywords": ["billing", "equipment fee", "router replacement", "credit",
                         "unlimited plan", "data limit", "promotion", "cancel anytime"],
            "customer_sentiment": "positive",
            "call_outcome": "Issue resolved + plan upgraded",
            "customer_pain_points": [
                "Unexpected $39.99 charge on the monthly bill",
                "Frequently close to the data limit",
            ],
            "objections_raised": [
                "Concern about the extra monthly cost of the unlimited plan",
                "Wants the flexibility to cancel the upgrade",
            ],
            "products_services_discussed": ["Unlimited Data plan", "Router replacement",
                                            "3-month price-match promotion"],
            "action_items": [
                "Apply $39.99 credit to the next statement",
                "Send plan-upgrade confirmation email within the hour",
            ],
            "follow_up_required": True,
            "follow_up_notes": "Check in before the 3-month promotion ends to confirm the customer wants to keep the plan.",
            "important_notes": "Billing error was caused by an equipment fee wrongly applied to a warranty replacement.",
        },
        "token_usage": {"input_tokens": 1896, "output_tokens": 245,
                        "total_tokens": 2141, "audio_tokens": None},
    }


def _quality_check() -> dict:
    criteria = [
        {"name": "Greeting & Introduction", "score": 10, "max": 10, "weight": 10,
         "status": "pass", "evidence": "Thank you for calling BrightNet Communications, my name is Sarah.",
         "feedback": "Professional greeting with company and agent name."},
        {"name": "Identity Verification", "score": 10, "max": 10, "weight": 15,
         "status": "pass", "evidence": "Can I please verify your account with your full name and the last four digits...",
         "feedback": "Verification done before account details were discussed."},
        {"name": "Empathy & Tone", "score": 9, "max": 10, "weight": 15,
         "status": "pass", "evidence": "I completely understand, an unexpected charge is never nice.",
         "feedback": "Good acknowledgement of frustration. She could have apologised for the billing error explicitly."},
        {"name": "Problem Diagnosis", "score": 9, "max": 10, "weight": 15,
         "status": "pass", "evidence": "I can see a one-time equipment fee of thirty-nine ninety-nine...",
         "feedback": "Root cause found quickly and accurately."},
        {"name": "Resolution", "score": 10, "max": 10, "weight": 20,
         "status": "pass", "evidence": "That fee was applied in error, and I'm removing it from your account now.",
         "feedback": "Issue resolved on first contact with a clear credit timeline."},
        {"name": "Sales Opportunity", "score": 8, "max": 10, "weight": 10,
         "status": "pass", "evidence": "Would you like to hear about our unlimited plan?",
         "feedback": "Upsell was relevant to the customer's usage. Introduce it only after confirming the customer is satisfied."},
        {"name": "Compliance Disclosures", "score": 6, "max": 10, "weight": 10,
         "status": "warning", "evidence": "You can switch back anytime with no penalty.",
         "feedback": "The price after the promo ended was not stated clearly before confirming the upgrade."},
        {"name": "Closing", "score": 10, "max": 10, "weight": 5,
         "status": "pass", "evidence": "Is there anything else I can help you with today?",
         "feedback": "Checked for other needs and closed the call warmly."},
    ]
    overall = round(sum(c["score"] / c["max"] * c["weight"] for c in criteria)
                    / sum(c["weight"] for c in criteria) * 100)
    return {
        "agent_name": "Sarah",
        "overall_score": overall,
        "grade": "A" if overall >= 90 else "B" if overall >= 80 else "C",
        "result": "Pass",
        "duration_sec": SAMPLE_CALL[-1][2],
        "criteria": criteria,
        "compliance_checks": [
            {"name": "Call recording disclosure", "passed": False},
            {"name": "Customer identity verified", "passed": True},
            {"name": "No sensitive data read aloud", "passed": True},
            {"name": "Pricing terms fully disclosed", "passed": False},
            {"name": "Confirmation of changes given", "passed": True},
        ],
        "strengths": [
            "Resolved the billing issue on first contact",
            "Calm, empathetic tone throughout",
            "Turned a complaint call into a successful upsell",
        ],
        "improvements": [
            "State the call-recording disclosure at the start of the call",
            "Give the full price after the promo ends before confirming the upgrade",
            "Apologise for company errors explicitly",
        ],
        "customer_satisfaction_prediction": 4.6,
    }


# (quality, summary, intent, keywords, signals, requirements, justification)
LEAD_CALLS = [
    ("Strong Lead",
     "The caller runs a garments business and wants to start shipping sample parcels to buyers in the USA every week. "
     "They asked for rates, transit time and whether a pickup can be arranged from their factory.",
     "Open a business account for regular international shipping.",
     ["international shipping", "rate", "pickup", "business account"],
     ["recurring weekly volume", "asked for a corporate rate"],
     ["Weekly export shipments to the USA", "Pickup from factory in Gazipur", "Corporate pricing"],
     "The customer has a clear, recurring shipping need and asked how to open an account, which is a direct sales opportunity."),
    ("Strong Lead",
     "A pharmaceutical exporter asked about temperature-controlled shipping to the Middle East and wanted a quotation.",
     "Get a quotation for cold-chain shipments.",
     ["quotation", "export", "cold chain"],
     ["asked for a quotation by email", "decision maker on the call"],
     ["Temperature-controlled shipping", "Quotation by email"],
     "The caller asked for a formal quotation for a new service, which is a strong buying signal."),
    ("Potential Lead",
     "The customer asked how much it costs to send documents to Canada and how long it takes, but has not decided yet.",
     "Compare document shipping prices to Canada.",
     ["rate", "documents", "international shipping"],
     ["price comparison"],
     ["Document shipment to Canada"],
     "The customer is interested in a new shipment and asked about price, but did not commit."),
    ("Weak Interest",
     "The caller asked general questions about which countries FedEx serves, without a specific shipment in mind.",
     "General information about service coverage.",
     ["international"],
     [],
     [],
     "Some interest in the service, but no concrete need or timeline was mentioned."),
]
NOT_LEAD_CALLS = [
    ("The customer called to check the delivery status of a parcel that is already in transit.",
     "Track an existing shipment.",
     "The call is about an existing shipment, not new business."),
    ("The customer asked for a refund of customs duty paid on an imported package.",
     "Get a refund for customs duty.",
     "A support request about a past shipment; there is no new shipping need."),
    ("The caller complained that the courier did not arrive on time and asked for the branch phone number.",
     "Complain about a late delivery.",
     "A complaint about an existing delivery, not a sales opportunity."),
]


def _lead_finder(params: dict, names: list[str] | None) -> dict:
    """Same shape as the live /find_leads API (api_docs/lead_finder.md)."""
    names = names or ["demo-call.wav"]
    custom = any(str(params.get(k) or "").strip()
                 for k in ("lead_keywords", "business_context", "not_a_lead_criteria"))
    results = []
    for i, name in enumerate(names):
        rng = random.Random(name)
        url = name.startswith(("http://", "https://"))
        base = {"index": i, "source": name, "source_type": "url" if url else "file"}
        if rng.random() < 0.05:
            results.append({**base, "status": "error", "error": "Could not read the audio file",
                            "call_summary": None, "customer_intent": None, "is_potential_lead": False,
                            "lead_quality": "Not a Lead", "confidence_score": 0, "keywords_matched": [],
                            "other_lead_signals": [], "business_requirements": [],
                            "justification": None, "tokens_used": 0})
            continue
        tokens = rng.randint(2000, 8000)
        if rng.random() < 0.38:
            q, summary, intent, kw, sig, req, why = rng.choice(LEAD_CALLS)
            results.append({**base, "status": "success", "error": None, "call_summary": summary,
                            "customer_intent": intent, "is_potential_lead": q != "Weak Interest",
                            "lead_quality": q, "confidence_score": rng.randint(62, 98),
                            "keywords_matched": kw, "other_lead_signals": sig,
                            "business_requirements": req, "justification": why, "tokens_used": tokens})
        else:
            summary, intent, why = rng.choice(NOT_LEAD_CALLS)
            results.append({**base, "status": "success", "error": None, "call_summary": summary,
                            "customer_intent": intent, "is_potential_lead": False,
                            "lead_quality": "Not a Lead", "confidence_score": rng.randint(80, 100),
                            "keywords_matched": [], "other_lead_signals": [], "business_requirements": [],
                            "justification": why, "tokens_used": tokens})
    ok = [r for r in results if r["status"] == "success"]
    count = lambda q: sum(r["lead_quality"] == q for r in ok)  # noqa: E731
    leads = [r for r in ok if r["is_potential_lead"]]
    return {
        "summary": {
            "criteria_used": "custom" if custom else "default_fedex",
            "total_calls": len(results), "analyzed": len(ok), "failed": len(results) - len(ok),
            "potential_leads": len(leads), "strong_leads": count("Strong Lead"),
            "potential_lead_quality": count("Potential Lead"), "weak_interest": count("Weak Interest"),
            "not_a_lead": count("Not a Lead"),
            "total_tokens_used": sum(r["tokens_used"] for r in results),
        },
        "leads": leads,
        "results": results,
    }


GENERATORS = {
    "call-recording-analysis": _analysis,
    "agent-quality-check": lambda p: _quality_check(),
}


async def generate(slug: str, params: dict, filename: str | None = None,
                   names: list[str] | None = None) -> dict:
    await _simulate_latency()
    if slug == "lead-finder":
        return _lead_finder(params, names)
    if slug == "call-transcription":
        return _transcript(params, filename)
    return GENERATORS[slug](params)
