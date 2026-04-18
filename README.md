# datahacks-2026
Team repo for datahacks 2026 

## Frontend (React)

The React frontend lives in `frontend/` (Vite + React).

```bash
cd frontend
npm install
npm run dev
```

# Environment 
If updated environment, run:
```bash
python -m venv datahack26
source datahack26/bin/activate        # Mac/Linux
datahack26\Scripts\activate           # Windows

pip install fastapi uvicorn pandas numpy ...
pip freeze > requirements.txt
```
To set up environment from existing requirements:
```bash
python -m venv datahack26
source datahack26/bin/activate        # Mac/Linux
datahack26\Scripts\activate           # Windows
pip install -r requirements.txt
```