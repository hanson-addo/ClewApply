"""Print the OpenAPI spec so the web app can generate its typed client."""

import json

from clew.main import app


def main() -> None:
    print(json.dumps(app.openapi(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
