#!/usr/bin/env node
'use strict';

const ArgumentParser = require('argparse').ArgumentParser;
const yaml = require('js-yaml');
const fs = require('fs');
const _ = require('underscore');
const path = require('path');
const parser = new ArgumentParser({
	version: '0.0.1',
	addHelp:true,
	description: 'A converter to transform a swagger.yaml file into Jekyll data.'
});
parser.addArgument([ '-d', '--docs' ], { help: 'The root of the docs folder.' });
const args = parser.parseArgs();
const resourceGroups = {
	orch: {
		name: 'Orchestration',
		weight: 0
	},
	mgmt: {
		name: 'Management',
		weight: 1
	},
	mon: {
		name: 'Monitoring',
		weight: 2
	},
	util: {
		name: 'Utility',
		weight: 3
	}
};
const resourceGroupMap = {
	'Commands': resourceGroups.orch,
	'Definitions': resourceGroups.orch,
	'Deployments': resourceGroups.orch,
	'Instances': resourceGroups.orch,
	'Components': resourceGroups.mon,
	'Metrics': resourceGroups.mon,
	'Events': resourceGroups.mon,
	'Images': resourceGroups.mgmt,
	'Resource Modules': resourceGroups.mgmt,
	'Resource Pools': resourceGroups.mgmt,
	'Snapshots': resourceGroups.mgmt,
	'Stores': resourceGroups.mgmt,
	'Versions': resourceGroups.util
};
var jekyllData = [];
var swaggerData;
var resource;

try {
	swaggerData = yaml.safeLoad(fs.readFileSync(path.join(args.docs, 'assets/swagger/swagger.yaml'), 'utf8'));
} catch (e) {
	console.log(e);
}

function preproccessDefinition(definition, name) {
	definition.properties = _.reduce(definition.properties, function(memo, prop, name) {
		var property = prop;
		// Transform 4.1: Set the key of the property as the 'name'.
		property.name = name;

		// Transform 4.2: Set 'required' if it is in the required list.
		property.required = definition.required && _.contains(definition.required, property.name);

		// Transform 4.3: Change enum types for 'string' to 'enum'.
		if (property.enum) {
			property.type = 'enum';
		}
		
		memo.push(property);
		return memo;
	}, []);
}

function resolveReferences(obj, name) {
	var definitionName;
    for (var key in obj) {
    	if (key == '$ref') {
    		console.log('Resolving ' + obj[key] + ' in ' + name);
    		definitionName = obj.$ref.replace('#/definitions/', '');
    		if (resource.indexOf(definitionName) > -1) {
    			obj.type = definitionName;
    		} else {
	    		obj.type = swaggerData.definitions[definitionName];
	    		obj.isRef = true;
    		}
            resolveReferences(obj.type, 'type');
    	}

        if (obj[key] !== null && typeof obj[key] == 'object') {
            resolveReferences(obj[key], key);
        }
    }
}

function renderModel(properties, offset='') {
	var isFirstProp = true,
		result;

	if (!Array.isArray(properties)) {
		if (properties.type == 'array') {
			if (typeof properties.items.type == 'string') {
				result = offset + (properties.items.format || properties.items.type) + '[]';
			} else {
				result = offset + '[\n';
				result += renderModel(properties.items.type.properties, offset + '  ');
				result += '\n' + offset + ']';
			}
			return result;
		} else if (typeof properties.type == 'object') {
			return renderModel(properties.type.properties, offset);
		} else if (typeof properties.type == 'string') {
			return offset + properties.type;
		}
	}

	result = offset + '{';

	_.each(properties, function(property) {
		var valueType = property.format || property.type;
		if (property.description) {
			if (!isFirstProp) {
				result += '\n';
				isFirstProp = false;
			}

			_.chain(property.description.split(' '))
				.reduce(function (memo, word) {
					if (!memo.length || ((_.last(memo) + word).length + 1) > 33) {
						memo.push(word);
					} else {
						memo[memo.length - 1] += ' ' + word;
					}

					return memo;
				}, [])
				.each(function(segment) {
					result += '\n' + offset + '  // ' + segment;
				});
		}
		
		result += '\n' + offset + '  "' + property.name + '": ';
		if (property.type == 'array' && typeof property.items.type == 'string') {
			result += (property.items.format || property.items.type) + '[]';
		} else if (typeof property.type == 'object') {
			result += renderModel(property.type, offset);
		} else {
			result += (property.format || property.type);
		}
	});

	result += '\n' + offset + '}';

	return result;
}

resource = _.reduce(swaggerData.tags, function(memo, tag) {
	memo.push(tag.name.replace(' ', '').slice(0,-1));
	return memo;
}, []);

console.log(resource);

_.each(swaggerData.definitions, preproccessDefinition);

_.each(swaggerData.definitions, resolveReferences);

jekyllData = _.reduce(swaggerData.tags, function(memo, tag) {
	// Transform 1: Clone the tag object to get the collection name and description.
	var collection  = _.clone(tag),
		isFirstProp = true,
		resourceName,
		resource,
		paths,
		segment;

	// Transform 2: Derive the collection path based on each tag.
	collection.basePath = '/api/' + collection.name.toLowerCase().replace(' ', '_');
	collection.group = resourceGroupMap[collection.name];

	// Transform 3: Extract and clone the apex resource of the collection. 
	resourceName = collection.name.slice(0,-1);
	resource = _.clone(swaggerData.definitions[resourceName.replace(' ', '')]);
	resource.name = resourceName;

	// Transform 4: Convert properties dictionary to an array.
	resource.properties = _.reduce(resource.properties, function(memo, property) {

		// Transform 4.2: Set 'required' if it is in the required list.
		property.required = resource.required && _.contains(resource.required, property.name);

		// Transform 4.3: Change enum types for 'string' to 'enum'.
		if (property.enum) {
			property.type = 'enum';
		}

		memo.push(property);
		return memo;
	}, []);


	//Transform 4.4: Format a JavaScript sample of the resource.
	resource.example = renderModel(resource.properties);

	// Transform 5: Removing required properties list.
	delete resource.required;

	// Transform 6: Add the resource to the collection.
	collection.resource = resource;

	// Transform 7: extract and transform associated paths.
	collection.paths = _.reduce(_.pairs(swaggerData.paths), function(memo, p) {
		var path = {};
		if (!p[0].startsWith(collection.basePath)) {
			return memo;
		}

		// Transform 7.1: Add the key to the path as its name.
		path.name = p[0];

		// Transform 7.2: Extract and transform associated methods.
		path.methods = _.reduce(_.pairs(p[1]), function(memo, m) {
			var method = {};
			var parameters;

			// Transform 7.2.1: Set key as name.
			method.name = m[0].toUpperCase();

			// Transform 7.2.2: Rename summary to description for consistency.
			method.description = m[1].summary;

			// Transform 7.2.3: Sort required parameter values to the top.
			parameters = _.sortBy(m[1].parameters, 'required').reverse();

			// Transform 7.2.4: Sort required parameter values to the top.
			method.parameters = _.groupBy(parameters, 'in');

			// Transform 7.2.5: If theres an assets collection in query, move it to formData.
			if (method.parameters.query) {
				_.each(method.parameters.query, function(param) {
					if (param.type == 'file' 
						|| (param.type == 'array' && param.items.type == 'file')) {
						param.in = "formData";
						method.parameters.query = _.without(method.parameters.query, param);
						method.parameters.formData.push(param);
						method.parameters.formData = _.sortBy(method.parameters.formData, 'required').reverse();
					}
				});

				if (!method.parameters.query.length) {
					delete method.parameters.query;
				}
			}

			// Transform 7.2.6: Convert responses into an array.
			method.responses = _.chain(m[1].responses)
									.pairs()
				 					.reduce(function(memo, r) {
										var response = _.clone(r[1]);

										response.code = r[0];

										resolveReferences(response, method.name + ' ' + path.name + ' ' + response.code);

										if (response.code >= 200 && response.code < 300) {
											method.model = response.schema;
										}

										memo.push(response);
										return memo;
									}, [])
				 					.sortBy('code')
				 					.value();

			if (method.model) {
				method.example = renderModel(method.model);
			}

			memo.push(method);
			return memo;
		}, []);


		memo.push(path);
		return memo;
	}, []);
	memo.push(collection);
	return memo;
}, jekyllData);

jekyllData = _.sortBy(jekyllData, 'name');
jekyllData = _.sortBy(jekyllData, function (collection) {
	if (!collection.group) {
		throw collection.name + ' doesn\'t have a group specified';
	}

	return collection.group.weight;
});


try {
	//console.dir(jekyllData);
	fs.writeFileSync(path.join(args.docs, '_data/api.json'), JSON.stringify(jekyllData, null, 4));
} catch (e) {
	console.log(e);
}

_.each(resourceGroupMap, function(value, key) {
	var includePath = path.join(args.docs, '_resources/', key.replace(' ', '_') + '.md');
	if (!fs.existsSync(includePath)) {
		try {
			fs.writeFileSync(includePath, '*This is a place holder*');
		} catch (e) {
			console.log(e);
		}
	}
});
