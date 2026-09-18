/**
 * A corpus of real Overpass queries.
 *
 * Drawn from the OSM wiki, the overpass-turbo examples and the shapes people
 * actually paste in. It is the input to three different checks:
 *
 *  - `corpus.test.ts` parses, prints and reparses each one, so the AST is
 *    stable and nothing is lost.
 *  - `compile.test.ts` expands the shortcuts and asserts the result is still
 *    valid Overpass QL.
 *  - `scripts/syntax-oracle.test.ts` sends the compiled output to a real
 *    Overpass instance, which is the only true oracle for the grammar. It is
 *    what caught `foreach` being printed with its input set in the wrong
 *    place, a mistake both the printer and the parser agreed on.
 *
 * Add a query here whenever one is reported as broken; that is what turns a
 * bug report into a regression test.
 */

export interface CorpusEntry {
  name: string
  query: string
  /** Set when the query cannot be sent as-is, e.g. it needs a map viewport. */
  needsViewport?: boolean
  /** Set when it geocodes a place name. */
  needsGeocoder?: boolean
}

export const CORPUS: CorpusEntry[] = [
  // ---------------------------------------------------------------------
  // The shapes a beginner meets first
  // ---------------------------------------------------------------------
  {
    name: 'simplest possible query',
    query: `node(50.7,7.1,50.8,7.2);out;`,
  },
  {
    name: 'standard prologue with a tag filter',
    query: `[out:json][timeout:25];
node["amenity"="restaurant"](50.7,7.1,50.8,7.2);
out body;`,
  },
  {
    name: 'the overpass-turbo default template',
    query: `[out:json][timeout:25];
{{geocodeArea:Lyon}}->.searchArea;
(
  node["amenity"="restaurant"](area.searchArea);
  way["amenity"="restaurant"](area.searchArea);
  relation["amenity"="restaurant"](area.searchArea);
);
out body;
>;
out skel qt;`,
    needsGeocoder: true,
  },
  {
    name: 'nwr shorthand with the viewport',
    query: `[out:json][timeout:25];
nwr["amenity"="cafe"]({{bbox}});
out geom;`,
    needsViewport: true,
  },

  // ---------------------------------------------------------------------
  // Tag filters, every operator
  // ---------------------------------------------------------------------
  {
    name: 'key exists and key absent',
    query: `[out:json];
node["name"][!"amenity"](50.7,7.1,50.8,7.2);
out;`,
  },
  {
    name: 'inequality and case-insensitive regex',
    query: `[out:json];
node["amenity"!="bench"]["name"~"caf",i](50.7,7.1,50.8,7.2);
out;`,
  },
  {
    name: 'negative regex',
    query: `[out:json];
way["highway"]["highway"!~"^(footway|path|cycleway)$"](50.7,7.1,50.8,7.2);
out;`,
  },
  {
    name: 'regex on the key itself',
    query: `[out:json];
node[~"^addr:"~"."](50.7,7.1,50.8,7.2);
out;`,
  },
  {
    name: 'unquoted keys and values',
    query: `[out:json];
node[amenity=bar](50.7,7.1,50.8,7.2);
out;`,
  },
  {
    name: 'values containing spaces and punctuation',
    query: `[out:json];
node["name"="Cafe de la Paix, Lyon"](50.7,7.1,50.8,7.2);
out;`,
  },
  {
    name: 'a value containing an escaped quote',
    query: `[out:json];
node["name"="L\\"Escale"](50.7,7.1,50.8,7.2);
out;`,
  },
  {
    name: 'several tag filters on one statement',
    query: `[out:json];
nwr["amenity"="restaurant"]["cuisine"~"pizza"]["opening_hours"]["wheelchair"!="no"](50.7,7.1,50.8,7.2);
out center;`,
  },

  // ---------------------------------------------------------------------
  // Spatial filters
  // ---------------------------------------------------------------------
  {
    name: 'area by id',
    query: `[out:json];
area(id:3600120965)->.a;
node["amenity"="pharmacy"](area.a);
out;`,
  },
  {
    name: 'area found by name',
    query: `[out:json][timeout:60];
area["name"="Bonn"]["admin_level"="6"]->.city;
node["amenity"="school"](area.city);
out center;`,
  },
  {
    name: 'around a set',
    query: `[out:json];
node["railway"="station"](50.7,7.1,50.8,7.2)->.stations;
node["amenity"="cafe"](around.stations:300);
out;`,
  },
  {
    name: 'around a coordinate',
    query: `[out:json];
node["amenity"="bar"](around:500,50.746,7.154);
out;`,
  },
  {
    name: 'around a list of coordinates',
    query: `[out:json];
node["amenity"](around:200,50.746,7.154,50.75,7.16);
out;`,
  },
  {
    name: 'polygon',
    query: `[out:json];
node["natural"="tree"](poly:"50.7 7.1 50.7 7.2 50.8 7.2");
out;`,
  },
  {
    name: 'pivot',
    query: `[out:json];
area["name"="Bonn"]->.a;
way(pivot.a);
out geom;`,
  },
  {
    name: 'global bbox setting',
    query: `[out:json][bbox:50.7,7.1,50.8,7.2];
node["amenity"="bench"];
out;`,
  },

  // ---------------------------------------------------------------------
  // Sets, unions, differences, recursion
  // ---------------------------------------------------------------------
  {
    name: 'union of three types',
    query: `[out:json];
(
  node["shop"](50.7,7.1,50.8,7.2);
  way["shop"](50.7,7.1,50.8,7.2);
  relation["shop"](50.7,7.1,50.8,7.2);
);
out center;`,
  },
  {
    name: 'difference of two queries',
    query: `[out:json];
(
  node["amenity"="parking"](50.7,7.1,50.8,7.2);
  - node["amenity"="parking"]["access"="private"](50.7,7.1,50.8,7.2);
);
out;`,
  },
  {
    name: 'difference with a union on each side',
    query: `[out:json];
(
  node["highway"="bus_stop"](50.7,7.1,50.8,7.2);
  way["highway"="bus_stop"](50.7,7.1,50.8,7.2);
  - node["highway"="bus_stop"]["disused"="yes"](50.7,7.1,50.8,7.2);
  way["highway"="bus_stop"]["disused"="yes"](50.7,7.1,50.8,7.2);
)->.stops;
.stops out;`,
  },
  {
    name: 'named sets chained through several statements',
    query: `[out:json];
way["highway"="cycleway"](50.7,7.1,50.8,7.2)->.cycle;
way.cycle["surface"="asphalt"]->.paved;
.paved out geom;`,
  },
  {
    name: 'intersection of two sets',
    query: `[out:json];
node["amenity"](50.7,7.1,50.8,7.2)->.a;
node["name"](50.7,7.1,50.8,7.2)->.b;
node.a.b;
out;`,
  },
  {
    name: 'every recursion operator',
    query: `[out:json];
way["building"](50.74,7.15,50.75,7.16);
>;
out skel qt;`,
  },
  {
    name: 'recurse up from nodes to ways',
    query: `[out:json];
node["highway"="crossing"](50.74,7.15,50.75,7.16)->.crossings;
way(bn.crossings);
out geom;`,
  },
  {
    name: 'recurse into relation members with a role',
    query: `[out:json];
relation["route"="bus"](50.7,7.1,50.8,7.2)->.routes;
node(r.routes:"stop");
out;`,
  },
  {
    name: 'complete set arithmetic with the default set',
    query: `[out:json];
node["amenity"="fountain"](50.7,7.1,50.8,7.2);
(._; >;);
out meta;`,
  },

  // ---------------------------------------------------------------------
  // Output variants
  // ---------------------------------------------------------------------
  {
    name: 'out with every modifier',
    query: `[out:json];
node["amenity"="bench"](50.74,7.15,50.75,7.16);
out meta geom qt 500;`,
  },
  {
    name: 'out ids only',
    query: `[out:json];
node["amenity"](50.74,7.15,50.75,7.16);
out ids;`,
  },
  {
    name: 'several out statements',
    query: `[out:json];
way["building"](50.74,7.15,50.75,7.16);
out body;
>;
out skel qt;`,
  },
  {
    name: 'csv output',
    query: `[out:csv("name","amenity","::lat","::lon";true;",")];
node["amenity"="restaurant"](50.7,7.1,50.8,7.2);
out;`,
  },
  {
    name: 'count',
    query: `[out:csv("::count")];
node["amenity"="bench"](50.7,7.1,50.8,7.2);
out count;`,
  },

  // ---------------------------------------------------------------------
  // Metadata filters
  // ---------------------------------------------------------------------
  {
    name: 'by element id',
    query: `[out:json];
node(id:240109189,240109190);
out;`,
  },
  {
    name: 'single id shorthand',
    query: `[out:json];
way(24940616);
out geom;`,
  },
  {
    name: 'by user and uid',
    query: `[out:json];
node["amenity"](50.7,7.1,50.8,7.2)(user:"Steve");
out meta;`,
  },
  {
    name: 'changed since a date',
    query: `[out:json];
node["amenity"](50.74,7.15,50.75,7.16)(newer:"2024-01-01T00:00:00Z");
out meta;`,
  },
  {
    name: 'an if condition',
    query: `[out:json];
way["building"](50.74,7.15,50.75,7.16);
out;`,
  },

  // ---------------------------------------------------------------------
  // Control flow
  // ---------------------------------------------------------------------
  {
    name: 'foreach',
    query: `[out:json];
way["building"](50.745,7.15,50.75,7.155)->.w;
foreach.w(
  out body;
  >;
  out skel qt;
);`,
  },
  {
    name: 'foreach with an output set',
    query: `[out:json];
way["building"](50.745,7.15,50.75,7.155);
foreach->.each(
  .each out body;
);`,
  },
  {
    name: 'foreach with both input and output sets',
    query: `[out:json];
way["building"](50.745,7.15,50.75,7.155)->.w;
foreach.w->.each(
  .each out body;
);`,
  },
  {
    name: 'foreach written with the input set in front, which the server rejects',
    // Not valid Overpass: the input set is a postfix on the keyword. Accepted
    // on the way in so that printing corrects it rather than leaving it broken.
    query: `[out:json];
way["building"](50.745,7.15,50.75,7.155)->.w;
.w foreach(
  out body;
);`,
  },
  {
    name: 'is_in at a point',
    query: `[out:json];
is_in(50.746,7.154)->.areas;
.areas out;`,
  },
  {
    name: 'is_in from a node set',
    query: `[out:json];
node(240109189);
is_in;
out;`,
  },

  // ---------------------------------------------------------------------
  // Things the block editor does not model, which must survive verbatim
  // ---------------------------------------------------------------------
  {
    name: 'make statement',
    query: `[out:json];
node["amenity"="bench"](50.74,7.15,50.75,7.16);
make stat number=count(nodes);
out;`,
  },
  {
    name: 'convert statement',
    query: `[out:json];
node["amenity"="bench"](50.74,7.15,50.75,7.16);
convert item ::=::,::geom=geom(),_osm_type=type();
out geom;`,
  },
  {
    name: 'comments everywhere',
    query: `// leading note
[out:json][timeout:25];
// what we are looking for
node["amenity"="bench"](50.74,7.15,50.75,7.16);
/* a block comment */
out;`,
  },

  // ---------------------------------------------------------------------
  // Formatting the parser must tolerate
  // ---------------------------------------------------------------------
  {
    name: 'everything on one line',
    query: `[out:json];node["amenity"="bar"](50.7,7.1,50.8,7.2);out;`,
  },
  {
    name: 'generous whitespace and newlines',
    query: `[out:json]
[timeout:25]
;

node
  [ "amenity" = "bar" ]
  ( 50.7 , 7.1 , 50.8 , 7.2 )
;

out ;`,
  },
  {
    name: 'negative coordinates',
    query: `[out:json];
node["place"="city"](-34.7,-58.5,-34.5,-58.3);
out;`,
  },
  {
    name: 'non-ascii tag values',
    query: `[out:json];
node["name"="Bergstrasse"]["name:de"="Bergstrasse"](50.7,7.1,50.8,7.2);
out;`,
  },
]

/** Corpus entries that can be sent to a server without any expansion. */
export const SENDABLE = CORPUS.filter((e) => !e.needsViewport && !e.needsGeocoder)
