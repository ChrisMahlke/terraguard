import json, numpy as np
minx,miny,maxx,maxy = -122.45,37.75,-122.38,37.80
xs = np.linspace(minx,maxx,8); ys = np.linspace(miny,maxy,8)
features=[]
for x in xs:
    features.append({"type":"Feature","properties":{"kind":"v"},
                     "geometry":{"type":"LineString","coordinates":[[x,miny],[x,maxy]]}})
for y in ys:
    features.append({"type":"Feature","properties":{"kind":"h"},
                     "geometry":{"type":"LineString","coordinates":[[minx,y],[maxx,y]]}})
geo={"type":"FeatureCollection","features":features}
open("data/roads.geojson","w").write(json.dumps(geo))
print("Wrote data/roads.geojson")