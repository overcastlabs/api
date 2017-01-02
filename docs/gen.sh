#!/bin/bash

swagger-codegen generate -i http://localhost:8042/v2/api-docs -l swagger-yaml -o _data
rm -Rf _data/README.md _data/LICENSE
