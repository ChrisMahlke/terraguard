import polars as pl, json, os

SRC = "data/processed/causes_2024_decoded.parquet"
OUT = "data/priors/pcc_top.json"
os.makedirs("data/priors", exist_ok=True)

def pad2_expr(col: str):
    # cast to int (if possible) then pad to 2 digits; keep None if missing
    return (
        pl.col(col)
        .cast(pl.Int64, strict=False)
        .apply(lambda x: f"{int(x):02d}" if x is not None else None, return_dtype=pl.Utf8)
    )

def strip_expr(col: str):
    # strip whitespace if string; otherwise pass through
    return (
        pl.col(col)
        .cast(pl.Utf8, strict=False)
        .apply(lambda s: s.strip() if isinstance(s, str) else s, return_dtype=pl.Utf8)
    )

df = pl.read_parquet(SRC, low_memory=True).with_columns(
    pl.col("PCC").cast(pl.Int64, strict=False),
    pad2_expr("GCC").alias("GCC"),
    pad2_expr("CAUSE_CODE").alias("CAUSE_CODE"),
    strip_expr("GCC_NAME").alias("GCC_NAME"),
    strip_expr("CAUSE_NAME").alias("CAUSE_NAME"),
)

# Count by PCC & (CAUSE_CODE,GCC) and pick the top combo per PCC.
grp = (
    df.group_by(["PCC","CAUSE_CODE","CAUSE_NAME","GCC","GCC_NAME"])
      .len()
      .sort(["PCC","len"], descending=[False, True])
)

top = grp.group_by("PCC").head(1)

mapping = {}
for r in top.iter_rows(named=True):
    mapping[str(int(r["PCC"]))] = {
        "GCC": r["GCC"],
        "GCC_NAME": r["GCC_NAME"],
        "CAUSE_CODE": r["CAUSE_CODE"],
        "CAUSE_NAME": r["CAUSE_NAME"],
        "count": int(r["len"]),
    }

with open(OUT, "w") as f:
    json.dump(mapping, f, indent=2, sort_keys=True)

print(f"Wrote {OUT} with {len(mapping)} PCC keys")
for k in list(mapping.keys())[:5]:
    print(k, "->", mapping[k])
