---
name: data-analysis
description: Analyze datasets (CSV, JSON, Parquet, SQL databases) with reproducible scripts - cleaning, statistics, aggregation and clear conclusions.
triggers: dataset, csv, pandas, analy, statistic, parquet, notebook, chart, aggregate, sql report
---
1. **Inspect before analyzing.** Load a sample; report the shape, columns and types, missing values, duplicates, value ranges and obvious anomalies. Never assume a column's meaning; check it.
2. **Work in reproducible scripts** (Python with pandas/polars/duckdb, or SQL) saved to files, not one-off console commands. Don't modify the raw data in place; write cleaned outputs to new files.
3. **Clean explicitly**: document every transformation (type casts, dropped rows and why, imputation, timezone normalization, deduplication keys).
4. **Answer the actual question.** Choose aggregations and statistics that fit it; report sample sizes; separate correlation from causation; check whether results hold across segments and over time (Simpson's paradox).
5. **Validate**: cross-check totals against the source, spot-check individual records, and sanity-check magnitudes.
6. **Communicate**: lead with the answer, then the supporting numbers (with units and time ranges), caveats and data-quality issues. Produce charts only when they clarify, with labelled axes.
7. **Privacy**: minimize personal data in outputs; aggregate or pseudonymize when sharing results.
