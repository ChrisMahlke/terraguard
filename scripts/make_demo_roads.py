import json

def linspace(start: float, stop: float, num: int):
    if num <= 1:
        return [start]
    step = (stop - start) / (num - 1)
    return [start + step * i for i in range(num)]

# Demo bbox (SF area). Feel free to tweak for local testing.
minx, miny, maxx, maxy = -122.45, 37.75, -122.38, 37.80

# Build a connected grid of short street segments so intersections share nodes.
# This makes the routing graph navigable and avoids straight-line fallbacks.
num_x = 12
num_y = 12
xs = linspace(minx, maxx, num_x)
ys = linspace(miny, maxy, num_y)

features = []

# Vertical segments between adjacent y's at each x
for x in xs:
    for j in range(len(ys) - 1):
        a = [float(x), float(ys[j])]
        b = [float(x), float(ys[j + 1])]
        features.append({
            "type": "Feature",
            "properties": {"highway": "residential"},
            "geometry": {"type": "LineString", "coordinates": [a, b]},
        })

# Horizontal segments between adjacent x's at each y
for y in ys:
    for i in range(len(xs) - 1):
        a = [float(xs[i]), float(y)]
        b = [float(xs[i + 1]), float(y)]
        features.append({
            "type": "Feature",
            "properties": {"highway": "residential"},
            "geometry": {"type": "LineString", "coordinates": [a, b]},
        })

geo = {"type": "FeatureCollection", "features": features}
with open("data/roads.geojson", "w") as f:
    f.write(json.dumps(geo))
print(f"Wrote data/roads.geojson with {len(features)} segments")