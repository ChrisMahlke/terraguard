import json
import polars as pl
from pathlib import Path

SRC = Path("data/processed/causes_2024_decoded.parquet")
OUT = Path("data/processed")
OUT.mkdir(parents=True, exist_ok=True)

df = pl.read_parquet(SRC)

# Ensure codes are strings (preserve leading zeros)
df = df.with_columns(
    pl.col("GCC").cast(pl.Utf8),
    pl.col("CAUSE_CODE").cast(pl.Utf8),
)

# --- counts
gcc_counts = (
    df.group_by(["GCC","GCC_NAME"])
      .len()
      .sort("len", descending=True)
      .rename({"len":"count"})
)
cause_counts = (
    df.group_by(["CAUSE_CODE","CAUSE_NAME"])
      .len()
      .sort("len", descending=True)
      .rename({"len":"count"})
)

gcc_counts.write_csv(OUT / "gcc_counts.csv")
cause_counts.write_csv(OUT / "cause_counts.csv")

# --- simple maps (code -> name)
gcc_map = (
    df.select("GCC","GCC_NAME").unique().sort("GCC")
    .to_dicts()
)
cause_map = (
    df.select("CAUSE_CODE","CAUSE_NAME").unique().sort("CAUSE_CODE")
    .to_dicts()
)

with open(OUT / "label_maps.json", "w") as f:
    json.dump({"GCC": gcc_map, "CAUSE_CODE": cause_map}, f, indent=2)

print("Wrote:",
      OUT / "gcc_counts.csv",
      OUT / "cause_counts.csv",
      OUT / "label_maps.json")