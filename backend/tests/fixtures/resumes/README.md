# Made-up resumes

Every person, company, school, address, phone number and link here is invented. None of it is
a real person's data. Keep it that way (CLAUDE.md engineering rules).

Each `<name>.txt` is a resume's text, which the tests turn into PDF and Word files.
`<name>.expected.json` is the profile a correct parse should produce. The tests use it as the
parser's answer, and `scripts/eval_parser.py` compares the real LLM's output against it.
