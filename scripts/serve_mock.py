# scripts/serve_mock.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import re

app = FastAPI(title="TerraGuard Mock API")

# Allow the Next.js dev server to call us
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class GenReq(BaseModel):
    prompt: str
    max_new_tokens: int | None = 64

@app.post("/api/generate")
def generate(req: GenReq):
    # Minimal heuristic: if PCC=12 appears (your README sample),
    # return a realistic, fixed classification; else "Unknown".
    if re.search(r"\bPCC\s*=\s*12\b", req.prompt):
        return {
            "GCC": "03",
            "GCC_NAME": "Equipment",
            "CAUSE_CODE": "05",
            "CAUSE_NAME": "Cooking",
        }
    return {
        "GCC": "07",
        "GCC_NAME": "Unknown",
        "CAUSE_CODE": "13",
        "CAUSE_NAME": "Unknown",
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
