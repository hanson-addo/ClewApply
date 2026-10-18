"""The master profile's shape: the JSON Resume schema (https://jsonresume.org/schema),
with lengths capped and unknown fields refused.

Left out on purpose:
- `references`: they hold other people's names and contact details.
- `basics.image`: a link the add-on would fetch; photos come later, if ever.
- Work authorization, veteran, disability and EEO answers. Those are sensitive answers,
  stored encrypted on their own (product rules), never in the profile.
"""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]
# JSON Resume dates: a year, a year and month, or a full date.
Date = Annotated[
    str, StringConstraints(pattern=r"^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$")
]
# Only web links: no javascript:, data: or file: links for the web app or add-on to open.
Url = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=500, pattern=r"^https?://[^\s]+$")
]
Email = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"),
]
Phone = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=40, pattern=r"^[0-9+()\-. x]*$")
]

Keywords = Annotated[list[ShortText], Field(max_length=50)]
Highlights = Annotated[list[LongText], Field(max_length=30)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Location(Strict):
    address: ShortText | None = None
    postalCode: Annotated[str, StringConstraints(max_length=20)] | None = None
    city: ShortText | None = None
    countryCode: Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}$")] | None = None
    region: ShortText | None = None


class SocialProfile(Strict):
    network: ShortText | None = None
    username: ShortText | None = None
    url: Url | None = None


class Basics(Strict):
    name: ShortText | None = None
    label: ShortText | None = None
    email: Email | None = None
    phone: Phone | None = None
    url: Url | None = None
    summary: LongText | None = None
    location: Location | None = None
    profiles: Annotated[list[SocialProfile], Field(max_length=20)] = []


class Work(Strict):
    name: ShortText | None = None
    position: ShortText | None = None
    location: ShortText | None = None
    url: Url | None = None
    startDate: Date | None = None
    endDate: Date | None = None
    summary: LongText | None = None
    highlights: Highlights = []


class Volunteer(Strict):
    organization: ShortText | None = None
    position: ShortText | None = None
    url: Url | None = None
    startDate: Date | None = None
    endDate: Date | None = None
    summary: LongText | None = None
    highlights: Highlights = []


class Education(Strict):
    institution: ShortText | None = None
    url: Url | None = None
    area: ShortText | None = None
    studyType: ShortText | None = None
    startDate: Date | None = None
    endDate: Date | None = None
    score: ShortText | None = None
    courses: Keywords = []


class Award(Strict):
    title: ShortText | None = None
    date: Date | None = None
    awarder: ShortText | None = None
    summary: LongText | None = None


class Certificate(Strict):
    name: ShortText | None = None
    date: Date | None = None
    issuer: ShortText | None = None
    url: Url | None = None


class Publication(Strict):
    name: ShortText | None = None
    publisher: ShortText | None = None
    releaseDate: Date | None = None
    url: Url | None = None
    summary: LongText | None = None


class Skill(Strict):
    name: ShortText | None = None
    level: ShortText | None = None
    keywords: Keywords = []


class Language(Strict):
    language: ShortText | None = None
    fluency: ShortText | None = None


class Interest(Strict):
    name: ShortText | None = None
    keywords: Keywords = []


class Project(Strict):
    name: ShortText | None = None
    description: LongText | None = None
    highlights: Highlights = []
    keywords: Keywords = []
    startDate: Date | None = None
    endDate: Date | None = None
    url: Url | None = None
    roles: Keywords = []
    entity: ShortText | None = None
    type: ShortText | None = None


class ProfileData(Strict):
    """A whole profile. Every section is optional, so a half-filled profile can be saved."""

    basics: Basics = Field(default_factory=Basics)
    work: Annotated[list[Work], Field(max_length=50)] = []
    volunteer: Annotated[list[Volunteer], Field(max_length=50)] = []
    education: Annotated[list[Education], Field(max_length=20)] = []
    awards: Annotated[list[Award], Field(max_length=50)] = []
    certificates: Annotated[list[Certificate], Field(max_length=50)] = []
    publications: Annotated[list[Publication], Field(max_length=50)] = []
    skills: Annotated[list[Skill], Field(max_length=100)] = []
    languages: Annotated[list[Language], Field(max_length=30)] = []
    interests: Annotated[list[Interest], Field(max_length=30)] = []
    projects: Annotated[list[Project], Field(max_length=50)] = []
