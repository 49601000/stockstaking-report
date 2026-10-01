# Data Directory

Put real inventory and stocktake files in `data/local/` when running this tool locally.

`data/local/` is ignored by Git. Keep production files, generated reports, screenshots, and review backups out of the repository.

The public sample list is `config/samples.json` and stays empty by default. For local convenience, create or update `config/samples.local.json` with paths such as:

```json
[
  {
    "name": "棚卸データ_20260921_130946.js",
    "path": "data/local/棚卸データ_20260921_130946.js"
  }
]
```
