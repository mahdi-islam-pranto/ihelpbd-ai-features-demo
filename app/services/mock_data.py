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


def _transcript() -> dict:
    segments = [
        {"speaker": s, "start": a, "end": b, "text": t}
        for s, a, b, t in SAMPLE_CALL
    ]
    words = sum(len(t.split()) for *_, t in SAMPLE_CALL)
    return {
        "language": "English (US)",
        "duration_sec": SAMPLE_CALL[-1][2],
        "word_count": words,
        "confidence": 0.962,
        "speakers": ["Agent", "Customer"],
        "segments": segments,
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


LEAD_POOL = [
    ("Priya Sharma", "Head of Operations", "Nimbus Logistics", "Logistics", 220),
    ("Daniel Brooks", "VP Customer Experience", "Crestline Insurance", "Insurance", 850),
    ("Aisha Rahman", "Contact Center Director", "Vertex Telecom", "Telecommunications", 1400),
    ("Marco Rossi", "Chief Revenue Officer", "BluePeak SaaS", "Software", 180),
    ("Emily Chen", "Sales Operations Manager", "Harbor Health Clinics", "Healthcare", 540),
    ("Lucas Meyer", "Director of Support", "UrbanCart Retail", "E-commerce", 390),
    ("Fatima Noor", "Customer Success Lead", "Lumen Finance", "Financial Services", 310),
    ("James O'Connor", "Head of Inside Sales", "Atlas Real Estate Group", "Real Estate", 120),
    ("Sofia Alvarez", "COO", "BrightPath Education", "Education", 260),
    ("Ryan Patel", "IT Director", "Summit Manufacturing", "Manufacturing", 980),
]

SIGNALS = [
    "Hiring 12+ call center agents", "Recently raised Series B funding",
    "Visited pricing page 3x this week", "Using outdated legacy CRM",
    "Expanding to 2 new regions", "Negative reviews mention long wait times",
    "Downloaded 'AI for Support' whitepaper", "New VP of CX joined 2 months ago",
    "Contract with competitor ends next quarter", "High volume of inbound calls",
]


def _leads(params: dict) -> dict:
    rng = random.Random(str(sorted(params.items())))
    industry = (params.get("industry") or "").strip()
    location = (params.get("location") or "").strip() or "United States"
    count = int(params.get("limit") or 8)

    pool = LEAD_POOL[:]
    rng.shuffle(pool)
    if industry and industry.lower() != "any":
        pool.sort(key=lambda x: x[3].lower() != industry.lower())

    leads = []
    for name, title, company, ind, employees in pool[:count]:
        score = rng.randint(58, 97)
        if industry and ind.lower() == industry.lower():
            score = min(99, score + 8)
        first, last = name.split(" ", 1)
        domain = company.lower().replace(" ", "").replace("'", "") + ".com"
        leads.append({
            "name": name,
            "title": title,
            "company": company,
            "industry": ind,
            "employees": employees,
            "location": location,
            "email": f"{first.lower()}.{last.split()[-1].lower().replace(chr(39), '')}@{domain}",
            "score": score,
            "intent": "High" if score >= 85 else "Medium" if score >= 70 else "Low",
            "signals": rng.sample(SIGNALS, 3),
            "reason": (f"{company} matches your ideal customer profile in {ind} "
                       f"and shows strong buying intent from recent activity."),
            "next_action": rng.choice([
                "Send personalised email with case study",
                "Connect on LinkedIn and book a discovery call",
                "Invite to product demo webinar",
                "Call directly. High urgency signals",
            ]),
        })
    leads.sort(key=lambda l: l["score"], reverse=True)
    return {
        "query": {"industry": industry or "Any", "location": location,
                  "company_size": params.get("company_size") or "Any"},
        "total_scanned": rng.randint(1800, 5200),
        "total_found": len(leads),
        "avg_score": round(sum(l["score"] for l in leads) / max(len(leads), 1)),
        "leads": leads,
    }


GENERATORS = {
    "potential-lead-finder": _leads,
    "call-recording-analysis": _analysis,
    "agent-quality-check": lambda p: _quality_check(),
    "call-recording-transcript": lambda p: _transcript(),
}


async def generate(slug: str, params: dict, filename: str | None = None) -> dict:
    await _simulate_latency()
    return GENERATORS[slug](params)
