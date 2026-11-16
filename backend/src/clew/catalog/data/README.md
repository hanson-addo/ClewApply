# us_places.csv

US cities and their map points, used to pin jobs on the Home map (`clew/catalog/geocode.py`). Each row is a region (two-letter state), a city, and a latitude and longitude rounded to 3 decimals.

Source: [GeoNames](https://www.geonames.org/) cities with 15,000 or more people, via the `geonamescache` package. Licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); attribution: "Contains data from GeoNames (geonames.org)". The privacy policy or about page should carry the same credit once the map ships.

To rebuild it, or to switch to the public-domain US Census Gazetteer places file, see `backend/scripts/build_us_places.py`. The app only reads this file. It never calls a geocoding service.
