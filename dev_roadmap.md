## Project Roadmap

### Project Title
**Solar Savings Engine**
Caculating a Solar oppurtunity score 


### One-line summary
A web app that helps identify where solar should be deployed next by combining geospatial environmental signals, existing solar permit patterns, and energy-cost/emissions estimates, starting with **UCSD** and later expanding to **San Diego ZIP codes**.

### Core user story
A user clicks a campus zone or ZIP code and gets:
- a **solar opportunity score**
- an estimate of **current conventional electricity cost**
- an estimate of **solar-adjusted cost**
- [OPTIONAL - if data available] **projected savings**
- [OPTIONAL - if data available] **estimated emissions reduction**
- [OPTIONAL - if data available] a short **AI-generated explanation**

### Problem
People and organizations do not have an intuitive way to see:
- where solar is most promising
- where conventional energy burden is highest
- where solar is already saturated or under-deployed
- and what the financial and climate upside would be from adding solar

### Solution
A map-based solar planning tool that:
- ranks candidate locations
- overlays solar adoption and environmental conditions
- estimates cost and emissions impact
- and explains the result in plain English

### Primary datasets
- **UCSD Campus Heat Map**: campus temperature/humidity variation; useful for geospatial environmental context and hotspot modeling
- **ZenPower Solar Permits**: installation permit records, capacities, locations, and processing timelines; useful for mapping existing solar footprint and capacity trends
- **US EIA Energy Data**: electricity, natural gas, petroleum, and CO2 time-series; useful for cost/emissions context and energy trend baselines

### ML use
- **Opportunity Scoring**: rank zones by solar potential using geospatial and adoption-related features
- **Cost Estimation**: estimate current conventional electricity cost and compare against a solar scenario
- **Prioritization**: identify high-value, low-saturation candidate areas
- **Impact Estimation**: estimate avoided emissions from switching part of demand to solar

### Cloud use
- hosted frontend for the map/dashboard
- backend API for predictions and summaries
- managed database for geospatial + tabular data
- optional scheduled ETL jobs for preprocessing
- LLM endpoint for explanation generation

### MVP scope
Keep it tight.

#### MVP v1
- UCSD-only map
- one location click interaction
- one combined score
- simple cost comparison
- simple climate impact estimate
- short AI explanation

#### Nice-to-have
- ranking table of best solar candidate locations
- downloadable report card for a location

---

## Product Architecture

### Frontend responsibilities
- map visualization
- layer toggles
- location selection
- results panel
- charts/cards for costs and savings
- [OPTIONAL - if data available] prompt-to-summary display

### Backend responsibilities
- dataset cleaning and joining
- feature engineering
- scoring logic / ML model
- cost and emissions estimator
- API endpoints
- optional LLM summary generation

---

## Recommended Stack

### Frontend
- **React**
- **Vite**
- **Tailwind CSS**
- **Mapbox GL JS** or **Leaflet**
- **Recharts** for cost/savings charts

### Backend
- **Python FastAPI**
- **pandas**
- **scikit-learn**
- **GeoPandas** if needed
- **XGBoost** or simple weighted scoring

### Data layer
- **PostgreSQL**
- **PostGIS** if using real geospatial queries
- or lightweight MVP: local CSVs / SQLite first, then upgrade

### Cloud
- **Vercel** for frontend
- **Render/Railway/Cloud Run** for backend
- **Supabase Postgres** if you want fast deployment

### AI
- **OpenAI** or **Gemini**
- only for explanation, not core logic

---

## Dataset Requirements

### UCSD Campus Heatmap
*Purpose: Find optimal solar panel placement locations*
- [ ] GPS coordinates / location identifiers for each measurement point
- [ ] Temperature or heat intensity values (surface or ambient)
- [ ] Timestamp or temporal coverage (to assess seasonal variation)
- [ ] Spatial resolution sufficient to distinguish rooftop/zone-level areas


### ZenPower Solar Permits
*Purpose: Overlay existing solar coverage; find gaps*
- [ ] Installation location (address, zip code, or lat/long)
- [ ] System capacity (kW or kWh — volume of electricity delivered)
- [ ] Installation date (to assess adoption trends over time)
- [ ] Site type (residential vs. commercial — affects scaling assumptions)


### EPA Environmental Data
*Purpose: Establish current emissions/pollution baseline for the area*
- [ ] Location identifiers (zip code, lat/long, or facility address)
- [ ] CO₂ or GHG emissions values per location
- [ ] Pollutant types relevant to energy production (NOx, SO₂, particulates)
- [ ] Temporal coverage overlapping your target period


### US EIA Energy Data
*Purpose: Get current electricity cost + predict post-solar cost reduction*
- [ ] Electricity price data by region or utility ($/kWh — for SDG&E territory)
- [ ] Consumption volume by location or sector (to estimate baseline cost)
- [ ] CO₂ emissions intensity per kWh (to calculate climate impact delta)
- [ ] Renewable vs. fossil fuel generation breakdown (to model the substitution)
