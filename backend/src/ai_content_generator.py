"""
AI Content Generator. Creates original content scripts for video reels.

Supports 4 content styles:
  - Story: First-person Reddit-style confessional stories
  - Q&A: Provocative questions with realistic comment answers
  - Interactive: "Put a finger down" challenges, quizzes with [PAUSE:N] markers
  - Hot Take: Controversial but safe opinion posts designed to drive engagement

Uses the existing AI provider infrastructure (Gemini/OpenRouter/Ollama/Nvidia NIM).

Author: Faheem Alvi
GitHub: https://github.com/FaheemAlvii
LinkedIn: https://www.linkedin.com/in/faheem-alvi
Email: faheemalvi2000@gmail.com
License: CC BY-NC 4.0
"""

import json
import os
import sys
import re
import time
from typing import Optional, Dict, List, Any
from datetime import datetime, timezone

if getattr(sys, "frozen", False):
    PROJECT_ROOT = os.path.dirname(sys.executable)
else:
    PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gemini_hooks import _call_ai, DEFAULT_OLLAMA_URL

# ── Niches ───────────────────────────────────────────────────────────

NICHES = {
    "relationship_drama": {
        "name": "Relationship Drama",
        "subs": "r/relationship_advice, r/AmItheAsshole, r/TIFU",
        "themes": "cheating, breakups, in-law conflicts, trust issues, secret discoveries",
    },
    "childhood_nostalgia": {
        "name": "Childhood Nostalgia",
        "subs": "r/AskReddit, r/nostalgia",
        "themes": "school memories, 90s/2000s kid experiences, embarrassing moments, first crushes",
    },
    "workplace_horror": {
        "name": "Workplace Horror",
        "subs": "r/antiwork, r/MaliciousCompliance, r/talesfromretail",
        "themes": "toxic bosses, quitting stories, revenge, unfair policies, coworker drama",
    },
    "dating_disasters": {
        "name": "Dating Disasters",
        "subs": "r/dating, r/Tinder, r/relationships",
        "themes": "worst dates, catfishing, ghosting, awkward encounters, dating app horror",
    },
    "family_secrets": {
        "name": "Family Secrets",
        "subs": "r/confessions, r/FamilyDrama",
        "themes": "hidden truths, adoption reveals, inheritance fights, double lives, DNA surprises",
    },
    "school_memories": {
        "name": "School Memories",
        "subs": "r/AskReddit, r/college",
        "themes": "teachers, bullying, pranks, graduation, friendships, detention stories",
    },
    "paranormal_encounters": {
        "name": "Paranormal Encounters",
        "subs": "r/nosleep, r/Paranormal, r/Glitch_in_the_Matrix",
        "themes": "ghost sightings, unexplained events, creepy encounters, sleep paralysis, haunted places",
    },
    "neighbor_stories": {
        "name": "Neighbor Stories",
        "subs": "r/neighborsfromhell, r/pettyrevenge",
        "themes": "boundary disputes, noise complaints, HOA wars, passive-aggressive notes, property drama",
    },
    "travel_nightmares": {
        "name": "Travel Nightmares",
        "subs": "r/travel, r/tifu",
        "themes": "missed flights, scams abroad, lost luggage, language barriers, sketchy hostels",
    },
    "food_culture": {
        "name": "Food & Culture",
        "subs": "r/AskReddit, r/food",
        "themes": "weird food combos, restaurant disasters, cultural food debates, cooking fails",
    },
}

# ── Content filter / audience instruction blocks ─────────────────────
# Per-run controls layered on top of the base system prompts. The tone
# and amount of risky language should move with the selected filter;
# the narrative POV should move with the target audience.

CONTENT_FILTERS = {
    "safe": (
        "LANGUAGE & BRAND-SAFETY (SAFE MODE):\n"
        "- Zero profanity of any kind. Not even mild ('damn', 'hell', 'crap').\n"
        "- Do NOT use the words: sex, gun, drug, kill, suicide, abuse, rape, murder, die. Use euphemisms ('hurt themselves', 'passed', 'in a bad way').\n"
        "- No slurs, no sexual content, no drug references, no graphic violence.\n"
        "- Fully advertiser-friendly. Must pass YouTube Kids filters."
    ),
    "normal": (
        "LANGUAGE & BRAND-SAFETY (NORMAL MODE):\n"
        "- Mild profanity allowed only when the moment demands it (max 1-2 uses total, 'damn'/'hell'/'crap'/'shit' at most).\n"
        "- No slurs, ever.\n"
        "- Risky topics (drinking, breakups, minor violence, mild romance) OK when plot-relevant; never gratuitous or graphic."
    ),
    "edgy": (
        "LANGUAGE & TONE (EDGY MODE):\n"
        "- Reddit-authentic voice. Curse words encouraged where natural — 'fuck', 'shit', 'bitch', 'asshole', 'dickhead', etc. Do not cap frequency.\n"
        "- Crude sexual references, drug use, drunk stories, bar fights, morally gray or unlikeable narrators are all welcome.\n"
        "- Politically incorrect opinions and offensive-humor rants are fine.\n"
        "- No softening, no 'and they learned a lesson' endings, no moralizing.\n"
        "- HARD LIMIT: do NOT use slurs targeting race, ethnicity, religion, or sexual orientation. Stick to general crude language."
    ),
}

def _filter_instruction(mode: Optional[str]) -> str:
    key = (mode or "normal").strip().lower()
    return CONTENT_FILTERS.get(key, CONTENT_FILTERS["normal"])

def _audience_instruction(audience: Optional[str]) -> str:
    a = (audience or "").strip()
    if not a:
        return ""
    return (
        f"TARGET AUDIENCE: {a}\n"
        "Tailor references, slang, emotional hooks, and character details (age, job, relationships, pop-culture touchstones) to feel native to this group. "
        "The narrator's voice should sound like someone this audience would recognize as 'one of us'."
    )

# ── Tone / emotional register (orthogonal to content-filter) ─────────
# The filter controls risky-language levels. Tone controls the emotional
# register of the story — same story skeleton can be funny or heartfelt.

TONE_INSTRUCTIONS = {
    "dramatic": (
        "EMOTIONAL REGISTER: DRAMATIC\n"
        "- High stakes, mounting tension, vivid peaks of conflict.\n"
        "- Every beat should escalate. The ending should hit hard."
    ),
    "funny": (
        "EMOTIONAL REGISTER: FUNNY\n"
        "- Lean into absurdity, self-deprecating narrator, comedic timing.\n"
        "- Readers should laugh out loud at least twice.\n"
        "- Punchlines > life lessons. The narrator is in on the joke."
    ),
    "heartfelt": (
        "EMOTIONAL REGISTER: HEARTFELT\n"
        "- Genuine emotion, vulnerability, a core human truth.\n"
        "- Aim to move people, not shock them. Earn the emotion — don't manufacture it.\n"
        "- Quiet moments land harder than big ones here."
    ),
    "shocking": (
        "EMOTIONAL REGISTER: SHOCKING\n"
        "- The twist should make viewers say 'WHAT.' out loud.\n"
        "- Escalate past what feels reasonable. Withhold key info until the reveal.\n"
        "- Prioritize the gut-punch moment over resolution."
    ),
    "cringe": (
        "EMOTIONAL REGISTER: CRINGE / SECONDHAND EMBARRASSMENT\n"
        "- Readers should physically wince. Lean into awkward, oblivious narrator moments.\n"
        "- The narrator often doesn't realize how bad the situation is — that's the point.\n"
        "- Specificity is what makes cringe work: the exact wrong thing said at the exact wrong moment."
    ),
}

def _tone_instruction(tone: Optional[str]) -> str:
    key = (tone or "dramatic").strip().lower()
    return TONE_INSTRUCTIONS.get(key, TONE_INSTRUCTIONS["dramatic"])

# ── Viral mechanics — shared across narrative styles ─────────────────
# These five beats are the difference between "AI-generated reddit story"
# and "thing a human watched all the way through." We name them
# explicitly because models trained on r/relationships data default to
# rambling intros and tidy moral endings — both of which kill watch
# time. Putting the rules in the prompt forces the model to hit the
# beats instead of producing generic-feeling content.
#
# Applies to: story, qa, hot_take. Interactive uses its own mechanics
# block (different shape — no narrative arc).

VIRAL_MECHANICS_NARRATIVE = """\
VIRAL MECHANICS — every script must hit all five beats:

1. HOOK (first sentence, ≤12 words):
   - Specific, not generic. NOT "I have a crazy story." YES "My fiancé's
     mom just texted me at 2am asking for her ring back."
   - Breaks pattern: name a number, name a specific person/object, or
     state an outcome that contradicts the setup.
   - Promises an answer the rest of the script will deliver.

2. STAKES (named by sentence 2):
   - What does the narrator stand to lose? Money, a relationship, a
     reputation, a child. Make it concrete.
   - If you can't name what's at stake in plain words, the rest of the
     script won't land.

3. ESCALATION (middle 60%):
   - Each new sentence raises the temperature OR reveals new info.
   - No filler — every line must move the story.
   - Bias toward dialogue and specific actions over summary ("she
     screamed at me" beats "she got upset").

4. TURN (~60-75% mark):
   - Something flips. The villain becomes sympathetic. The narrator
     realizes they were wrong. A piece of evidence appears.
   - Without a turn, the script is a list of complaints. Lists die.

5. CLOSER (last 1-2 sentences):
   - Take a strong side ("AITA? I don't think so.") or leave one
     dangling question that begs comment ("Would you have stayed?").
   - NEVER end with "and I learned a lesson" or "anyway thanks for
     reading." Those are dead air.
   - The closer is a comment-bait — your goal is to make scrolling
     viewers stop and type.
"""

VIRAL_MECHANICS_INTERACTIVE = """\
VIRAL MECHANICS — interactive content lives or dies by these:

1. HOOK STATEMENT (first item):
   - The opener is the bait. It should be a near-universal experience
     that makes 80% of viewers nod ("…if you've ever pretended to read
     a text to look busy"). They WILL keep watching to see if the
     later items call them out.

2. ESCALATION (item ordering):
   - Common → niche → specific. The first 3 items should feel almost
     too easy. Items 4-7 narrow. Items 8-10 are oddly specific.
   - Specificity is the engagement engine. "Put a finger down if you
     own more than 4 black t-shirts" beats "if you wear black often."

3. THE CALLOUT (mid-list):
   - One item should feel like you're reading the viewer's mind.
     This is the moment they share the video to a friend.

4. PAYOFF / SCORING:
   - End with a punchline-flavored result, not a generic 'how many
     fingers do you have left.' Tie the score to identity ("0 fingers
     means you were definitely the funny friend in your group").
"""

# Self-critique tail — appended to every system prompt. The trick is
# making the model do quality control as part of the same call: it
# drafts, audits, then rewrites BEFORE emitting JSON. Costs ~0 extra
# tokens vs. emitting once badly, and consistently lifts output quality
# more than a second LLM pass would. Models trained with chain-of-
# thought traces (Gemini, Claude, GPT-4 class) respect this strongly;
# weaker local models (Ollama 7B) ignore it but still don't get worse.
SELF_CRITIQUE_TAIL = """\
QUALITY GATE — apply this BEFORE you emit the JSON:

Step 1. Draft the content normally.
Step 2. Re-read your draft. Identify the THREE weakest beats — usually
        a generic hook, a missing turn, or a moralizing closer.
Step 3. Rewrite ONLY those weak beats. Keep the rest intact.
Step 4. Output the FINAL revised version as JSON. Do not show me the
        critique — only the final script.
"""

# ── System Prompts ───────────────────────────────────────────────────

STORY_SYSTEM_PROMPT = """You are a viral Reddit storyteller. Write a first-person confessional story that sounds 100% authentic — like a real Reddit post.

{filter_instruction}

{audience_instruction}

{tone_instruction}

{viral_mechanics}

CRAFT RULES:
- Specific details: invented names, ages, locations, timestamps. Vague stories die.
- Casual Reddit voice — contractions, sentence fragments OK, NOT formal prose.
- 800-1500 characters total. Tight is better than long.
- NO emojis, NO hashtags, NO markdown, NO stage directions, NO asterisks.
- Do NOT prefix the title with "AITA" or "TIFU" — start naturally.

EXAMPLE OF A STRONG OPENING (study the hook + stakes pattern, do NOT
copy the content):

  Title: "My sister wore my wedding dress to her engagement party"
  Body:  "I haven't spoken to my sister Megan in 6 weeks. Last month
          she got engaged and threw an engagement party at our parents'
          house — I wasn't invited because we 'have history.' I found
          out what happened from my cousin who sent me a photo. Megan
          was wearing my wedding dress. The dress I got married in two
          years ago. The dress that's been hanging in my parents'
          spare closet because we don't have storage in our apartment.
          When I called my mom she said 'oh she just borrowed it for
          fun, don't be dramatic'…"

  ↑ Why it works: hook names a specific outrageous act (8 words);
  stakes (relationship, dress sentimentality) named by sentence 3;
  every line reveals new info; clear villain + complicit parents set
  up the turn.

NICHE: {niche_name}
THEMES TO DRAW FROM: {niche_themes}
SUBREDDITS THIS WOULD FIT: {niche_subs}

{topic_instruction}

{self_critique}

Output ONLY valid JSON with this exact structure:
{{"title": "A compelling Reddit-style title", "body": "The full story text..."}}"""

QA_SYSTEM_PROMPT = """You are writing a viral AskReddit-style thread. ONE punchy question + 5-7 realistic comment answers, ordered for maximum watch time.

{filter_instruction}

{audience_instruction}

{tone_instruction}

VIRAL MECHANICS — Q&A specifics:

1. THE QUESTION (the hook):
   - Provokes an immediate gut response. "What's the meanest thing
     someone said that you'll never forget?" beats "What was a sad
     moment?" — specificity + invitation to confess.
   - ≤14 words. Asks for a specific MOMENT, not a general opinion.
   - Avoid yes/no questions, opinion polls, or "what's your favorite."

2. THE ORDERING (this is the watch-time engine):
   - Comment #1 must be punchy and self-contained — viewers decide
     whether to keep watching in the first 6 seconds.
   - Comments 2-3: relatable / funny — the viewer thinks "lol same."
   - Comments 4-5: escalate to darker / shocking territory.
   - Final comment (6 or 7): the gut punch. The one viewers screenshot.

3. ANSWER SHAPE:
   - 100-300 chars each, written like a real human typing fast.
   - Mix lengths. A one-line zinger between two 250-char answers
     creates rhythm.
   - Each answer must contain at least one specific detail (a name, a
     number, an object, a place).

4. USERNAMES:
   - Realistic reddit handles. NOT "JohnDoe123". YES "throwaway_4real",
     "depressed-pickle", "ihatemybossbob", "anonymous_potato".
   - Mix throwaways with character names. Username is part of the joke.

EXAMPLE STRONG ANSWERS (study the rhythm, do NOT copy):

  Q: "What's the most cursed thing a stranger has said to you?"
  A1 (throwaway_2024): "Lady at the gym told me my form was great
      'for someone with my body type' and walked away."
  A2 (corporate_zombie): "Coworker said 'oh you're still here' on a
      day I had been promoted."
  A3 (sleep_deprived): "Old man on a bus pointed at my baby and said
      'that one will hurt you.' Baby is 2. Doing fine. So far."

  ↑ Why these work: each is a specific moment with a clean shape,
  builds darker, ends on a button.

NICHE: {niche_name}
THEMES TO DRAW FROM: {niche_themes}
SUBREDDITS THIS WOULD FIT: {niche_subs}

{topic_instruction}

{self_critique}

Output ONLY valid JSON with this exact structure:
{{"title": "The AskReddit question as the title", "question": "Same question or expanded version", "comments": [{{"author": "username123", "body": "Their answer..."}}, ...]}}"""

INTERACTIVE_SYSTEM_PROMPT = """You are a viral short-form video content creator specializing in interactive engagement content.

Create a "{format_type}" challenge/quiz that hooks viewers and makes them participate.

{filter_instruction}

{audience_instruction}

{tone_instruction}

{viral_mechanics}

FORMATS:
- "put_a_finger_down": 8-12 statements starting with "Put a finger down if..." from common to rare. End with a scoring punchline tied to identity.
- "would_you_rather": 6-8 impossible "Would you rather" dilemmas. Each must be genuinely hard — if one option is obviously better, scrap it.
- "rate_yourself": 8-10 "Give yourself a point if..." statements. End with a tiered result ("0-3: ___ / 4-7: ___ / 8+: ___").
- "guess_the_answer": 5-6 trivia/riddle questions. Each followed by a [PAUSE:3], then the reveal.

CRAFT RULES:
- Every statement/question is followed by [PAUSE:3] (or pause_seconds:3) — viewers need think time, that's the entire format.
- ≤200 chars per statement.
- Specificity beats generality every time. "Put a finger down if your
  spotify wrapped told on you this year" >> "Put a finger down if you
  listen to music a lot."
- 45-90 seconds total.
- NO emojis, NO hashtags, NO markdown.

EXAMPLE SHAPE (study the escalation, do NOT copy):

  Title: "Put a finger down — millennial edition"
  1.  "…if you remember the AIM door opening sound"           [common]
  2.  "…if you had a Razr phone and texted in T9"             [common]
  3.  "…if you printed out song lyrics from LimeWire"          [niche]
  4.  "…if you wore Heelys to the mall food court"            [niche]
  5.  "…if you hosted a Pottermore sorting party in 2011"     [specific]
  6.  "…if you still miss the Scholastic Book Fair smell"     [emotional]
  7.  "…if your screen name had numbers AND xX's around it"   [callout]
  8.  "If you have 0 fingers left, you peaked at 17. Sorry."  [punchline]

  ↑ Why it works: opens with an instant-recognition memory, narrows
  to specific lived experiences, ends with an identity tag. Item 7 is
  the share moment — the one viewers send to friends.

NICHE: {niche_name}
THEMES TO DRAW FROM: {niche_themes}

{topic_instruction}

{self_critique}

Output ONLY valid JSON with this exact structure:
{{"title": "Catchy title for the challenge", "segments": [{{"text": "Put a finger down if...", "pause_seconds": 3}}, ...]}}

The LAST segment should be the scoring punchline (with pause_seconds: 0)."""

HOT_TAKE_SYSTEM_PROMPT = """You are a viral opinion writer who crafts controversial takes — the kind that get thousands of comments because everyone has a strong reaction.

{filter_instruction}

{audience_instruction}

{tone_instruction}

{viral_mechanics}

CRAFT RULES — hot-take specifics:
- The take must split a room ~50/50. If 90% of viewers agree, it's a
  truism, not a hot take. If 90% disagree, it's just trolling. Aim for
  the genuinely-divisive middle.
- Open with the take itself, declared bluntly. NOT "I have an unpopular
  opinion that maybe…" YES "Birthday parties for adults are sad."
- 400-800 characters in the body, written like a rant, not an essay.
- Defend the take with ONE specific example or anecdote, not abstract
  reasoning. Real life > rhetoric.
- NO emojis, NO hashtags, NO markdown, NO "fight me" / "downvote me"
  meta-commentary — that's hack-tier.

EXAMPLE STRONG HOT TAKE (study the directness + payoff):

  Title: "Tipping should be illegal in sit-down restaurants"
  Body:  "I'm tired of pretending the tipping system makes sense. We
          don't tip our doctor. We don't tip the airline pilot. We
          don't tip the person doing our taxes. We've decided that one
          specific job — bringing food from a kitchen to a table — is
          where we let employers offload payroll onto customers as a
          guilt tax. Last week a server on TikTok cried because she
          made $400 in tips on a Saturday night. That's not a bug,
          that's the system working as intended: random strangers
          subsidizing a wage the restaurant won't pay. Just put it on
          the menu. We're all adults."

  ↑ Why it works: clear take in the title, specific example (TikTok
  server), names the structural absurdity, closes with a sharp button.

NICHE: {niche_name}
THEMES TO DRAW FROM: {niche_themes}

{topic_instruction}

{self_critique}

Output ONLY valid JSON with this exact structure:
{{"title": "The hot take as a bold statement", "body": "The full opinion/rant defending it..."}}"""

# Interactive format types
INTERACTIVE_FORMATS = [
    {"id": "put_a_finger_down", "name": "Put a Finger Down", "desc": "Relatable statement challenge"},
    {"id": "would_you_rather", "name": "Would You Rather", "desc": "Impossible choice dilemmas"},
    {"id": "rate_yourself", "name": "Rate Yourself", "desc": "Point-based self-rating quiz"},
    {"id": "guess_the_answer", "name": "Guess the Answer", "desc": "Trivia & riddles with reveals"},
]


# ── Content Generator ────────────────────────────────────────────────

class AIContentGenerator:
    """Generates original viral content using AI models."""

    def __init__(self, config: dict):
        """Initialize from the app's config.json."""
        gemini_cfg = config.get("gemini", {})
        self.provider = gemini_cfg.get("provider", "gemini")
        self.model = gemini_cfg.get("model", "gemini-2.0-flash")
        self.ollama_url = gemini_cfg.get("ollama_url", DEFAULT_OLLAMA_URL)

        # Pick API key based on provider
        if self.provider == "ollama":
            self.api_key = ""
        elif self.provider == "openrouter":
            self.api_key = gemini_cfg.get("openrouter_api_key", "")
            if not self.model or self.model.startswith("gemini"):
                self.model = "google/gemini-2.0-flash-exp:free"
        elif self.provider == "nvidia_nim":
            self.api_key = gemini_cfg.get("nvidia_nim_api_key", "")
            if not self.model:
                self.model = "meta/llama-3.1-405b-instruct"
        else:
            self.api_key = gemini_cfg.get("api_key", "")

        self.used_topics_path = os.path.join(PROJECT_ROOT, "used_topics.json")

    def _load_used_topics(self) -> List[str]:
        if os.path.exists(self.used_topics_path):
            try:
                with open(self.used_topics_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return []
        return []

    def _save_topic(self, topic_summary: str):
        topics = self._load_used_topics()
        topics.append(topic_summary)
        # Keep last 100
        topics = topics[-100:]
        with open(self.used_topics_path, "w", encoding="utf-8") as f:
            json.dump(topics, f, indent=2)

    def _topic_instruction(self, custom_topic: Optional[str] = None) -> str:
        recent = self._load_used_topics()[-20:]
        parts = []
        if custom_topic:
            parts.append(f"SPECIFIC TOPIC TO WRITE ABOUT: {custom_topic}")
        if recent:
            parts.append("AVOID these recently used themes (do NOT repeat):\n- " + "\n- ".join(recent))
        return "\n\n".join(parts) if parts else "Choose a fresh, unique angle."

    def _call(self, prompt: str, system_prompt: str, max_tokens: int = 1500) -> Optional[str]:
        """Call the AI provider with higher token limit for content generation."""
        # We reuse _call_ai but content generation needs more tokens
        # The underlying providers have their own defaults; we rely on the prompt to control length
        return _call_ai(self.provider, self.api_key, prompt, system_prompt, self.model, self.ollama_url)

    def _parse_json_response(self, raw: str) -> Optional[dict]:
        """Extract and parse JSON from AI response, handling markdown code blocks and thinking tags."""
        if not raw:
            return None
        # Strip <think>...</think> reasoning blocks
        cleaned = re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL).strip()
        # Strip markdown code fences
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines)

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            # Try to find JSON object in the text
            match = re.search(r'\{[\s\S]*\}', cleaned)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    pass
        return None

    def _generate_with_retry(self, prompt: str, system_prompt: str, required_keys: List[str], retries: int = 3) -> Optional[dict]:
        """Generate content with retry logic for JSON parsing failures."""
        for attempt in range(retries):
            raw = self._call(prompt, system_prompt)
            if not raw:
                print(f"⚠️  AI returned empty (attempt {attempt + 1}/{retries})")
                continue

            parsed = self._parse_json_response(raw)
            if parsed and all(k in parsed for k in required_keys):
                return parsed

            print(f"⚠️  Invalid JSON or missing keys (attempt {attempt + 1}/{retries})")
            if attempt < retries - 1:
                # Reinforce JSON requirement
                prompt = prompt + "\n\nIMPORTANT: Output ONLY valid JSON. No extra text before or after the JSON object."
                time.sleep(2)

        return None

    # ── Public generators ────────────────────────────────────────────

    def generate_story(self, niche: str, custom_topic: Optional[str] = None,
                       content_filter: Optional[str] = None,
                       target_audience: Optional[str] = None,
                       tone: Optional[str] = None) -> Optional[dict]:
        """Generate a story-mode post. Returns {title, body} or None."""
        niche_info = NICHES.get(niche, NICHES["relationship_drama"])
        system = STORY_SYSTEM_PROMPT.format(
            niche_name=niche_info["name"],
            niche_themes=niche_info["themes"],
            niche_subs=niche_info["subs"],
            topic_instruction=self._topic_instruction(custom_topic),
            filter_instruction=_filter_instruction(content_filter),
            audience_instruction=_audience_instruction(target_audience),
            tone_instruction=_tone_instruction(tone),
            viral_mechanics=VIRAL_MECHANICS_NARRATIVE,
            self_critique=SELF_CRITIQUE_TAIL,
        )
        prompt = f"Write a viral Reddit story in the {niche_info['name']} niche. Make it unforgettable."

        result = self._generate_with_retry(prompt, system, ["title", "body"])
        if result:
            self._save_topic(f"Story: {result['title'][:80]}")
        return result

    def generate_qa(self, niche: str, custom_topic: Optional[str] = None, num_answers: int = 6,
                    content_filter: Optional[str] = None,
                    target_audience: Optional[str] = None,
                    tone: Optional[str] = None) -> Optional[dict]:
        """Generate a Q&A post. Returns {title, question, comments[]} or None."""
        niche_info = NICHES.get(niche, NICHES["relationship_drama"])
        system = QA_SYSTEM_PROMPT.format(
            niche_name=niche_info["name"],
            niche_themes=niche_info["themes"],
            niche_subs=niche_info["subs"],
            topic_instruction=self._topic_instruction(custom_topic),
            filter_instruction=_filter_instruction(content_filter),
            audience_instruction=_audience_instruction(target_audience),
            tone_instruction=_tone_instruction(tone),
            self_critique=SELF_CRITIQUE_TAIL,
        )
        prompt = f"Write a viral AskReddit thread in the {niche_info['name']} niche with {num_answers} answers."

        result = self._generate_with_retry(prompt, system, ["title", "comments"])
        if result:
            self._save_topic(f"Q&A: {result['title'][:80]}")
            # Ensure question field exists
            if "question" not in result:
                result["question"] = result["title"]
        return result

    def generate_interactive(self, niche: str, format_type: str = "put_a_finger_down",
                             custom_topic: Optional[str] = None,
                             content_filter: Optional[str] = None,
                             target_audience: Optional[str] = None,
                             tone: Optional[str] = None) -> Optional[dict]:
        """Generate interactive engagement content. Returns {title, segments[{text, pause_seconds}]} or None."""
        niche_info = NICHES.get(niche, NICHES["childhood_nostalgia"])
        fmt = next((f for f in INTERACTIVE_FORMATS if f["id"] == format_type), INTERACTIVE_FORMATS[0])

        system = INTERACTIVE_SYSTEM_PROMPT.format(
            format_type=fmt["name"],
            niche_name=niche_info["name"],
            niche_themes=niche_info["themes"],
            topic_instruction=self._topic_instruction(custom_topic),
            filter_instruction=_filter_instruction(content_filter),
            audience_instruction=_audience_instruction(target_audience),
            tone_instruction=_tone_instruction(tone),
            viral_mechanics=VIRAL_MECHANICS_INTERACTIVE,
            self_critique=SELF_CRITIQUE_TAIL,
        )
        prompt = f"Create a '{fmt['name']}' challenge video about {niche_info['name']}."

        result = self._generate_with_retry(prompt, system, ["title", "segments"])
        if result:
            self._save_topic(f"Interactive ({fmt['name']}): {result['title'][:60]}")
            # Ensure segments have pause_seconds
            for seg in result.get("segments", []):
                if "pause_seconds" not in seg:
                    seg["pause_seconds"] = 3
        return result

    def generate_hot_take(self, niche: str, custom_topic: Optional[str] = None,
                          content_filter: Optional[str] = None,
                          target_audience: Optional[str] = None,
                          tone: Optional[str] = None) -> Optional[dict]:
        """Generate a hot take / opinion post. Returns {title, body} or None."""
        niche_info = NICHES.get(niche, NICHES["relationship_drama"])
        system = HOT_TAKE_SYSTEM_PROMPT.format(
            niche_name=niche_info["name"],
            niche_themes=niche_info["themes"],
            topic_instruction=self._topic_instruction(custom_topic),
            filter_instruction=_filter_instruction(content_filter),
            audience_instruction=_audience_instruction(target_audience),
            tone_instruction=_tone_instruction(tone),
            viral_mechanics=VIRAL_MECHANICS_NARRATIVE,
            self_critique=SELF_CRITIQUE_TAIL,
        )
        prompt = f"Write a hot take about {niche_info['name']}."

        result = self._generate_with_retry(prompt, system, ["title", "body"])
        if result:
            self._save_topic(f"Hot Take: {result['title'][:80]}")
        return result

    def generate(self, content_style: str, niche: str,
                 custom_topic: Optional[str] = None,
                 interactive_format: str = "put_a_finger_down",
                 content_filter: Optional[str] = None,
                 target_audience: Optional[str] = None,
                 tone: Optional[str] = None) -> Optional[dict]:
        """
        Unified entry point. Returns the generated content dict or None.
        Adds a 'content_style' key to the result for downstream processing.
        """
        if content_style == "story":
            result = self.generate_story(niche, custom_topic, content_filter, target_audience, tone)
        elif content_style == "qa":
            result = self.generate_qa(niche, custom_topic,
                                      content_filter=content_filter,
                                      target_audience=target_audience,
                                      tone=tone)
        elif content_style == "interactive":
            result = self.generate_interactive(niche, interactive_format, custom_topic,
                                               content_filter=content_filter,
                                               target_audience=target_audience,
                                               tone=tone)
        elif content_style == "hot_take":
            result = self.generate_hot_take(niche, custom_topic, content_filter, target_audience, tone)
        else:
            print(f"❌ Unknown content style: {content_style}")
            return None

        if result:
            result["content_style"] = content_style
        return result


# ── Helpers for external use ─────────────────────────────────────────

def get_available_niches() -> List[dict]:
    """Return list of available niches for the UI."""
    return [{"id": k, "name": v["name"], "themes": v["themes"]} for k, v in NICHES.items()]

def get_interactive_formats() -> List[dict]:
    """Return list of interactive format types for the UI."""
    return INTERACTIVE_FORMATS
