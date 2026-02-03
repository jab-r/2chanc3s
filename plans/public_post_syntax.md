1) User-facing syntax

Inline token
	•	📍 + place name (place name is either a quoted string or an unquoted run until a delimiter)

Examples:
	•	Meet me at 📍Findlay Market at 7
	•	Coffee at 📍"Stumptown Coffee Roasters" tomorrow
	•	Hike: 📍Ault Park #outdoors @jon

Delimiters (stop the place-name)

End the place name when you hit:
	•	newline
	•	double space
	•	punctuation: . , ; : ! ? ) ] }
	•	another token start: @, #, 📍
	•	an URL start (http://, https://) (optional, but recommended)

Escapes / edge cases
	•	Quoted form supports \" inside
	•	Unquoted form trims trailing spaces and punctuation

⸻

2) Grammar (EBNF-ish)
```
message        = { segment } ;

segment        = location | mention | hashtag | url | text ;

location       = "📍" ( quoted_place | bare_place ) ;

quoted_place   = '"' { qchar } '"' ;
qchar          = escape | ~['"'] ;
escape         = "\" ('"' | "\" | "n" | "t") ;

bare_place     = place_char { place_char } ;
place_char     = ~[ "\n"
                   "." "," ";" ":" "!" "?" 
                   ")" "]" "}"
                   "@" "#" "📍" ] ;
```
Notes:
	•	bare_place intentionally allows spaces. The delimiter set is what stops it.
	•	You can tighten/loosen what counts as a delimiter without changing the model.
3) Query structure (JSON)
The client browser will parse a query string into a JSON structure which will be sent to the ../2chanc3s endpoint which will query the posts DB.
An example structure is **something like**
```
{
  "text": "Meet at 📍Findlay Market #food",
  "tokens": [
    { "type": "text", "value": "Meet at ", "span": { "start": 0, "end": 8 } },
    { "type": "location", "raw": "📍Findlay Market", "name": "Findlay Market", "quoted": false, "span": { "start": 8, "end": 23 } },
    { "type": "text", "value": " ", "span": { "start": 23, "end": 24 } },
    { "type": "hashtag", "value": "food", "span": { "start": 24, "end": 29 } }
  ],
  "entities": {
    "locations": [
      {
        "name": "Findlay Market",
        "span": { "start": 8, "end": 23 },
        "candidates": [
          {
            "provider": "nominatim",
            "provider_id": "123",
            "lat": 39.1149,
            "lon": -84.5190,
            "h3": { "resolution": 9, "index": "8928308280fffff" },
            "confidence": 0.86
          }
        ],
        "chosen": {
          "provider": "nominatim",
          "provider_id": "123",
          "lat": 39.1149,
          "lon": -84.5190,
          "h3": { "resolution": 9, "index": "8928308280fffff" },
          "confidence": 0.86
        }
      }
    ],
    "mentions": [],
    "hashtags": ["food"]
  }
}
```

It is the job of the designing task to design the optimal JSON structure
