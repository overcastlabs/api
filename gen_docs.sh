#!/bin/bash

swagger-codegen generate -i http://localhost:8042/v2/api-docs -l swagger-yaml -o docs/assets/swagger
rm -Rf docs/assets/swagger/README.md docs/assets/swagger/LICENSE
cp docs/assets/swagger/swagger.yaml docs/_data
