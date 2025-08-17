import polars as pl
from pathlib import Path

SRC = Path("data/processed/causes_2024_decoded.parquet")
OUT_FULL = Path("data/processed/causes_features.parquet")
OUT_SAMPLE = Path("data/samples/causes_features_1k.parquet")

df = pl.read_parquet(SRC)

# Ensure types are friendly
df = df.with_columns(
    pl.col("INC_DATE").cast(pl.Date, strict=False),
    pl.col("EXP_NO").cast(pl.Int64, strict=False),
    pl.col("PCC").cast(pl.Int64, strict=False),
    pl.col("GCC").cast(pl.Utf8),
    pl.col("CAUSE_CODE").cast(pl.Utf8),
)

# Derived features for quick baselines and sanity checks
df = df.with_columns(
    pl.col("INC_DATE").dt.year().alias("year"),
    pl.col("INC_DATE").dt.month().alias("month"),
    pl.col("INC_DATE").dt.weekday().alias("weekday"),  # Mon=0 ... Sun=6
    (pl.col("EXP_NO") > 0).cast(pl.Int8).alias("is_exposure")
)

# Labels (keep as strings to preserve leading zeros)
df = df.with_columns(
    pl.col("GCC").alias("label_gcc"),
    pl.col("CAUSE_CODE").alias("label_cause")
)

# Write full features parquet
df.write_parquet(OUT_FULL)

# Also write a 1k sample for quick experiments
df.sample(n=min(1000, df.height), shuffle=True, seed=42).write_parquet(OUT_SAMPLE)

# Print a tiny preview
print("Wrote:", OUT_FULL, "and", OUT_SAMPLE)
print("\nSchema:")
print(df.schema)

print("\nHead:")
print(df.select([
    "INCIDENT_KEY","STATE","FDID","INC_DATE","EXP_NO","PCC",
    "label_gcc","label_cause","month","weekday","is_exposure"
]).head(5))

print("\nLabel counts (GCC top 7):")
print(df.group_by(["label_gcc"]).len().sort("len", descending=True))

print("\nLabel counts (CAUSE top 10):")
print(df.group_by(["label_cause"]).len().sort("len", descending=True).head(10))