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
STORY STRUCTURE — every short-form story is a tiny three-act play.
Every piece you write must have a clear:

  SETUP → INCITING INCIDENT → ESCALATION → CLIMAX → RESOLUTION

These are HOW you write, not WHAT you write. Never label them in the
body. The reader experiences the structure invisibly.

1. TITLE + HOOK (sentence 1):
   - Title names a SPECIFIC, SURPRISING moment or detail from the
     story — not the topic, not the genre.
   - BAD (just the topic): "Caught my GF cheating and got revenge"
   - GOOD (a concrete moment): "Caught my GF cheating because she
     Venmo'd him $14 for parking"
   - First sentence ≤14 words, specific, and promises a reveal the
     reader doesn't yet know.

2. SETUP (sentences 2-3):
   - Establish who the narrator is, who else matters, and what
     "normal" looks like — in two sentences. No more.
   - Do NOT explain the stakes in plain words. The reader should
     feel them from the situation.

3. INCITING INCIDENT (sentence 4-5):
   - ONE specific event that breaks normal and starts the story.
   - Concrete and witnessed — a text, a photo, a phone call, a
     thing the narrator personally saw. Not a vague "I started
     noticing things were off."

4. ESCALATION (middle 40-50% of the script):
   - Two or three CONCRETE developments, each adding NEW information.
   - NOT "and then I noticed more weird things." Each beat must
     advance the story with specifics: a name, a place, a number, an
     action.
   - Brief dialogue allowed, but never a 4-line back-and-forth. Pick
     the ONE line that mattered, paraphrase the rest.
   - Cut anything that doesn't reveal or raise the temperature.

5. CLIMAX (one specific moment, near the end):
   - There must be ONE single moment where everything snaps into
     focus. The reveal. The confrontation. The single discovery
     that recontextualizes the whole story.
   - DO NOT stack multiple half-reveals. Stacking ambiguous clues
     with no single climactic moment is the #1 way short-form
     stories fall flat.
   - The climax must be a moment the reader could PINPOINT if asked
     "what was the punch?"

6. RESOLUTION + CLOSER (last 1-2 sentences):
   - Brief aftermath: what immediately happened next.
   - Take a strong side ("I don't regret a thing.") or leave a
     question that begs comment ("Would you have stayed?").
   - NEVER end with "and I learned a lesson," "thanks for reading,"
     or generic "what would you do?" If you ask a question, make it
     specific to the story.

BEHAVIORAL REALISM — non-negotiable:
- Characters act like real adults under stress. Real people don't go
  from smug → crying in two lines. Real people don't deliver
  monologues. Real cheaters deny first, get caught a second time,
  then break.
- If the topic is REVENGE: the revenge must be plausible enough that
  a real person would actually do it AND get away with it. No
  movie-villain antics. No ketchup-in-drawers, no slashing tires, no
  cartoon pranks. Best revenge is usually small, specific, and legal.
- If the topic is a DISCOVERY: the discovery itself should be the
  climax — one tiny specific detail that unraveled everything — not
  a stack of vague clues that the narrator pieces together.
- All character names, relationships, and events introduced earlier
  must remain consistent. If you mention "his fiancée" at the end,
  her existence had to be implicit from earlier in the story. Do
  not invent new characters in the climax.

OUTPUT HYGIENE — these words / patterns are BANNED in the body:
- Section labels: "Stakes:", "Hook:", "Turn:", "Closer:", "The
  closer hit me…", "Setup:", "Climax:", "Resolution:", or any
  other craft-term used as story prose.
- Scene headers, [brackets], asterisks, parentheticals, "*"
  emphasis — just prose.
- Title prefixes: do NOT prefix with "AITA", "TIFU", "Story:",
  "Update:".
- Hack-tier filler words: "viral", "epic", "insane", "wild",
  "you won't believe."
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

Step 2. STRUCTURE AUDIT. Re-read your draft and answer in your head:
        a) Can I name, in one sentence, the SINGLE climactic moment?
           If the answer is "well, there's the photo, and then the
           text, and then…" — you've stacked half-reveals instead
           of building to one moment. Rewrite so there is ONE clear
           climax.
        b) Are all characters introduced BEFORE the climax? If a new
           character (a fiancée, a sibling, a coworker) appears for
           the first time in the climax, they must have been at
           least implied earlier. Either set them up or remove them.
        c) Does the script have a setup → inciting incident →
           escalation → climax → resolution shape, in that order?
           If the climax happens in sentence 3 and the rest is
           aftermath, restructure.

Step 3. CHRONOLOGY + CAUSE-EFFECT AUDIT. Re-read as if a skeptical
        friend is poking holes:
        a) Time markers are consistent. If sentence 1 says "last
           night," sentence 8 cannot say "yesterday" referring to the
           same event. Pick one timeline and stick to it.
        b) Each character only knows / does what prior events made
           possible. If the narrator hasn't met someone yet, they
           cannot reference "the look on his face." If a character
           was just dumped, they cannot calmly cooperate with the
           dumper's plan in the very next paragraph.
        c) When the topic is REVENGE: the revenge action must
           actually inflict damage. Handing someone copies of texts
           THEY ALREADY SENT is not revenge — they already saw those
           texts. If you wrote a 'revenge' that doesn't actually
           harm or embarrass the target, replace it.
        d) Characters' emotional states change at human speed. A
           person caught cheating breaks down OR gets defensive,
           but they don't then volunteer to help the person who
           caught them in their next move.
        e) The narrator can only describe what they personally saw
           or heard. They cannot report another character's facial
           expression in a room they weren't in.

        If you find ANY violation, fix it before continuing. Most
        common fix: cut the inconsistent paragraph entirely and
        rewrite a tighter version.

Step 4. CRAFT AUDIT. Identify the THREE weakest beats from a craft
        standpoint — usually a generic hook, a missing turn, or a
        moralizing closer. Rewrite only those.

Step 5. Output the FINAL revised version as JSON. Do not show me the
        audits — only the final script.
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

EXAMPLE OF A STRONG OPENING (study the shape, do NOT copy the
content). Note how it has ZERO meta labels, almost no dialogue, and
every sentence reveals something new:

  Title: "My sister wore my wedding dress to her engagement party"
  Body:  "I haven't spoken to my sister Megan in 6 weeks. Last month
          she got engaged and threw an engagement party at our parents'
          house — I wasn't invited because we 'have history.' I found
          out what happened from my cousin, who sent me a photo. Megan
          was wearing my wedding dress. The actual dress I got married
          in two years ago. The dress that's been hanging in my
          parents' spare closet because we don't have room in our
          apartment. When I called my mom, all she said was that
          Megan 'just borrowed it for fun, don't be dramatic.' That's
          when I drove over and saw the rest of my stuff already
          packed in boxes by the front door…"

  ↑ Why it works: title names a specific outrageous moment (NOT 'my
  family is crazy'). No labeled stakes — the dress's sentimental
  weight comes through naturally. One brief line of paraphrased
  dialogue, no four-line dialogue scenes. Every sentence delivers a
  new fact. Clear villain + complicit parent set up an obvious turn.

EXAMPLE OF A WEAK OPENING (avoid all of these patterns):

  Title: "Caught my GF cheating and got epic revenge"
  Body:  "I found out yesterday that my girlfriend of two years was
          cheating with this guy named Alex. Stakes: our relationship
          and my self-respect were on the line. I waited until midnight
          and confronted her. 'Hey babe,' she says. 'Sit down,' I tell
          her. She tries to deny it but can't keep eye contact…"

  ↑ Why it fails: title is the genre, not a moment. Body literally
  writes "Stakes:" as a label. Dialogue is wooden ping-pong. Reads
  like an AI following a checklist instead of telling a story.

EXAMPLE OF A STRUCTURALLY-BROKEN STORY (this one has a strong-ish
hook but fails on STRUCTURE — study why it falls apart):

  Title: "He kept choosing my friends, then I found out why"
  Body:  "I noticed Liam choosing my friend's party over dinner.
          Then I scrolled Instagram and saw a comment 'Liam's so
          lucky to have both of you!'. That's when I started
          digging — my friend tagged us in a wedding planner story.
          The caption read 'I can't believe @Liam_and_Me are
          planning together!' Then I found his phone connected to
          her email account. The closer hit me when I saw them at
          the mall holding hands in a photo. He had been using me
          to shield his secret relationship from his fiancée."

  ↑ Why it fails STRUCTURALLY:
  - No single climax. The story stacks 4 different half-reveals
    (comment → wedding tag → email account → mall photo) and none
    is THE moment. Reader can't point to "the punch."
  - "his fiancée" appears in the last sentence, but she was never
    set up. New character invented at the climax.
  - Body says "The closer hit me when…" — literal craft term as
    prose. This is banned.
  - The narrator's investigation is muddled — clues come from
    Instagram, then the friend's story, then his email, then a
    different photo. Pick ONE thread and follow it cleanly.

  How to fix: collapse to ONE clean discovery. e.g. "I clicked the
  Instagram tag and saw the wedding planner had captioned them
  '@Liam_and_Sara — engaged 6 months.' Sara was my best friend."
  That's a single reveal that recontextualizes everything before
  it. THAT is a climax.

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
