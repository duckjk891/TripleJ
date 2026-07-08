# Custom Elasticsearch image: base 8.12.0 + Korean morphological analyzer (nori).
# The analysis-nori plugin must be baked into the image because plugins live
# outside the `es_data` volume — installing it at runtime would not survive a
# container recreate. Build via:
#   docker compose -p backend build elasticsearch
FROM docker.elastic.co/elasticsearch/elasticsearch:8.12.0

RUN bin/elasticsearch-plugin install --batch analysis-nori
