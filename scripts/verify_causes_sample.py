import polars as pl

# Load the CSV sample
df = pl.read_csv("data/samples/causes_decoded_1k.csv", infer_schema_length=2000)

print("Rows:", df.height, "Cols:", df.width)
print("Columns:", df.columns)

# Parse date (safe/for info)
df = df.with_columns(
    pl.col("inc_date").str.strptime(pl.Date, format="%Y-%m-%d", strict=False)
)

print("\nDate range:")
print(df.select(pl.min("inc_date").alias("min_date"), pl.max("inc_date").alias("max_date")))

print("\nTop GCC groups:")
print(
    df.group_by(["GCC","GCC_NAME"])
      .count()
      .sort("count", descending=True)
      .head(10)
)

print("\nTop CAUSE groups:")
print(
    df.group_by(["CAUSE_CODE","CAUSE_NAME"])
      .count()
      .sort("count", descending=True)
      .head(10)
)