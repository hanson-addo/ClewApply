"""Hand-set weights for the fit score (#23). Each part scores 0 to 1; the fit score is their
weighted average, shown as 0 to 100.

Semantic similarity (embeddings) joins later, once an embedding model is chosen. Until then
these parts carry the whole score.
"""

TITLE = 0.30
SKILLS = 0.25
LOCATION = 0.15
RECENCY = 0.15
SENIORITY = 0.10
SALARY = 0.05

# A job this many days old scores half on recency; twice as old, a quarter.
RECENCY_HALF_LIFE_DAYS = 14
# Matching this many skills counts as a full skills match.
SKILLS_FOR_FULL_MATCH = 10
# A part scoring at least this can be one of the job's reasons.
REASON_THRESHOLD = 0.7
