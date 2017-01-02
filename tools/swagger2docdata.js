#!/usr/bin/env node
'use strict';

var ArgumentParser = require('argparse').ArgumentParser;
var yaml = require('js-yaml');
var fs = require('fs');
var _ = require('underscore');
var parser = new ArgumentParser({
	version: '0.0.1',
	addHelp:true,
	description: 'A converter to transform a swagger.yaml file into Jekyll data.'
});
parser.addArgument([ '-i', '--input' ], { help: 'The swagger.yaml file to convert.' });
parser.addArgument([ '-o', '--output' ], { help: 'The patht to output the api.js file to.' });
var args = parser.parseArgs();
var jekyllData = [];
var swaggerData;

try {
	swaggerData = yaml.safeLoad(fs.readFileSync(args.input, 'utf8'));
} catch (e) {
	console.log(e);
}

jekyllData = _.reduce(swaggerData.tags, function(memo, tag) {
	// Transform 1: Clone the tag object to get the collection name and description.
	var collection  = _.clone(tag);
	var resourceName;
	var resource;
	var paths;

	// Transform 2: Derive the collection path based on each tag.
	collection.basePath = '/api/' + collection.name.toLowerCase().replace(' ', '_');

	// Transform 3: Extract and clone the apex resource of the collection. 
	resourceName = collection.name.slice(0,-1);
	resource = _.clone(swaggerData.definitions[resourceName.replace(' ', '')]);
	resource.name = resourceName;

	// Transform 4: Convert properties dictionary to an array.
	resource.properties = _.reduce(_.pairs(resource.properties), function(memo, prop) {
		var property = prop[1];
		// Transform 4.1: Set the key of the property as the 'name'.
		property.name = prop[0];

		// Transform 4.2: Set 'required' if it is in the required list.
		property.required = resource.required && _.contains(resource.required, property.name);
		
		memo.push(property);
		return memo;
	}, []);
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

		// Transform 7.1: Extract and transform associated methods.
		path.methods = _.reduce(_.pairs(p[1]), function(memo, m) {
			var method = {};
			var parameters;

			// Transform 7.1.1: Rename summary to description for consistency.
			method.description = m[1].summary;

			// Transform 7.1.2: Sort required parameter values to the top.
			parameters = _.sortBy(m[1].parameters, 'required').reverse();

			// Transform 7.1.3: Sort required parameter values to the top.
			method.parameters = _.groupBy(parameters, 'in');

			// Transform 7.1.4: If theres an assets collection in query, move it to formData.
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

			// Transform 7.1.5: Convert responses into an array.
			method. responses = _.chain(m[1].responses)
									.pairs()
				 					.reduce(function(memo, r) {
										var response = _.clone(r[1]);

										response.code = r[0];
										memo.push(response);
										return memo;
									}, [])
				 					.sortBy('code')
				 					.value();

			// Transform 7.1.6: Set key as name.
			method.name = m[0].toUpperCase();

			memo.push(method);
			return memo;
		}, []);

		// Transform 7.1: Add the key to the path as its name.
		path.name = p[0];


		memo.push(path);
		return memo;
	}, []);
	memo.push(collection);
	return memo;
}, jekyllData);


try {
	console.dir(jekyllData);
	fs.writeFileSync(args.output, JSON.stringify(jekyllData, null, 4));
} catch (e) {
	console.log(e);
}
