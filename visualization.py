import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib import cm, colors
import folium

# -----------------------------
# load CSV with headers
# -----------------------------
filename = "./data/20250511_bike.csv"
df = pd.read_csv(filename)

# Parse columns by name
df["TIME"] = pd.to_datetime(df["TIME"], errors="coerce")

Time = df["TIME"].copy()
LAT  = df["LATITUDE"].astype(float).copy()
LONG = df["LONGITUDE"].astype(float).copy()
ALT  = df["ALTITUDE"].astype(float).copy()
Temp = df["TEMPERATURE"].astype(float).copy()
RH   = df["RELATIVE_HUMIDITY"].astype(float).copy()

# -----------------------------
# filter data with no GPS fix in San Diego
# -----------------------------
bad = (LAT < 32) | (LAT > 34)

Time.loc[bad] = pd.NaT
LAT.loc[bad]  = np.nan
LONG.loc[bad] = np.nan
ALT.loc[bad]  = np.nan
Temp.loc[bad] = np.nan
RH.loc[bad]   = np.nan

# -----------------------------
# plot color-coded heat map prep
# -----------------------------
deltaT = [np.nanmin(Temp), np.nanmax(Temp)]
cmap = cm.get_cmap("jet")
norm = colors.Normalize(vmin=deltaT[0], vmax=deltaT[1])

# -----------------------------
# convert GMT to local time
# -----------------------------
# Your old MATLAB code did GMT - 8 hours.
# Keep this only if your timestamps are actually GMT/UTC.
local_time = Time - pd.Timedelta(hours=8)

# -----------------------------
# plot time series of temperature and relative humidity
# -----------------------------
fig, axes = plt.subplots(2, 1, figsize=(12.8, 7.2), facecolor="white")

axes[0].plot(local_time, Temp, "-r", linewidth=2)
axes[0].set_ylabel("temperature (°C)")

axes[1].plot(local_time, RH, "-b", linewidth=2)
axes[1].set_xlabel("local time")
axes[1].set_ylabel("relative humidity (%)")

plt.tight_layout()
plt.show()

# -----------------------------
# build Leaflet map
# -----------------------------
valid = (
    local_time.notna() &
    LAT.notna() &
    LONG.notna() &
    Temp.notna()
)

LATv = LAT[valid].to_numpy()
LONGv = LONG[valid].to_numpy()
Tempv = Temp[valid].to_numpy()

center_lat = np.mean(LATv)
center_lon = np.mean(LONGv)

m = folium.Map(
    location=[center_lat, center_lon],
    zoom_start=12,
    tiles="Esri.WorldImagery",
    attr="Esri"
)

# Draw colored temperature segments
for i in range(len(Tempv) - 1):
    rgba = cmap(norm(Tempv[i]))
    hex_color = colors.to_hex(rgba)

    folium.PolyLine(
        locations=[
            [LATv[i], LONGv[i]],
            [LATv[i + 1], LONGv[i + 1]]
        ],
        color=hex_color,
        weight=4,
        opacity=1
    ).add_to(m)

m.save("bike_temperature_map.html")

print("Done")
print("Leaflet map saved to bike_temperature_map.html")