import numpy as np
import pandas as pd
import folium
from folium.plugins import HeatMap, MarkerCluster

# -----------------------------
# load data
# -----------------------------
df = pd.read_csv("./data/zenpower/san_diego_zenpower_data.csv")
df = df.dropna(subset=["latitude", "longitude"])

res_df = df[df["property_type"] == "Residential"]
com_df = df[df["property_type"] == "Commercial"]

center_lat = df["latitude"].mean()
center_lon = df["longitude"].mean()

# -----------------------------
# base map
# -----------------------------
m = folium.Map(
    location=[center_lat, center_lon],
    zoom_start=11,
    tiles="CartoDB positron",
)

# -----------------------------
# heatmap layer — all installs
# -----------------------------
heat_data = df[["latitude", "longitude"]].values.tolist()
HeatMap(
    heat_data,
    name="Installation Density (Heatmap)",
    min_opacity=0.35,
    radius=14,
    blur=18,
    max_zoom=14,
    gradient={0.2: "#313695", 0.4: "#74add1", 0.6: "#fee090", 0.8: "#f46d43", 1.0: "#a50026"},
).add_to(m)

# -----------------------------
# residential markers cluster
# -----------------------------
res_cluster = MarkerCluster(name="Residential Installs", show=False)
for _, row in res_df.iterrows():
    kw = row["kilowatt_value"]
    folium.CircleMarker(
        location=[row["latitude"], row["longitude"]],
        radius=5,
        color="#2ecc71",
        fill=True,
        fill_color="#2ecc71",
        fill_opacity=0.75,
        popup=folium.Popup(
            f"<b>Residential</b><br>"
            f"{row['full_address']}<br>"
            f"<b>{kw:.2f} kW</b><br>"
            f"Permit: {row['permit_type']}<br>"
            f"Issued: {str(row['issue_date'])[:10]}",
            max_width=280,
        ),
    ).add_to(res_cluster)
res_cluster.add_to(m)

# -----------------------------
# commercial markers cluster
# -----------------------------
com_cluster = MarkerCluster(name="Commercial Installs", show=False)
for _, row in com_df.iterrows():
    kw = row["kilowatt_value"]
    folium.CircleMarker(
        location=[row["latitude"], row["longitude"]],
        radius=8,
        color="#e74c3c",
        fill=True,
        fill_color="#e74c3c",
        fill_opacity=0.85,
        popup=folium.Popup(
            f"<b>Commercial</b><br>"
            f"{row['full_address']}<br>"
            f"<b>{kw:.2f} kW</b><br>"
            f"Permit: {row['permit_type']}<br>"
            f"Issued: {str(row['issue_date'])[:10]}",
            max_width=280,
        ),
    ).add_to(com_cluster)
com_cluster.add_to(m)

# -----------------------------
# kW-weighted heatmap layer
# -----------------------------
kw_cap = df["kilowatt_value"].quantile(0.95)
df["kw_weight"] = (df["kilowatt_value"].clip(upper=kw_cap) / kw_cap).round(4)
kw_heat_data = df[["latitude", "longitude", "kw_weight"]].values.tolist()
HeatMap(
    kw_heat_data,
    name="kW-Weighted Density",
    min_opacity=0.35,
    radius=16,
    blur=20,
    max_zoom=14,
    gradient={0.2: "#0d0887", 0.4: "#7e03a8", 0.65: "#cc4778", 0.85: "#f89540", 1.0: "#f0f921"},
    show=False,
).add_to(m)

# -----------------------------
# legend HTML
# -----------------------------
legend_html = """
<div style="
    position: fixed; bottom: 40px; left: 40px; z-index: 1000;
    background: white; padding: 14px 18px; border-radius: 10px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25); font-family: Arial, sans-serif;
    font-size: 13px; line-height: 1.7;
">
  <b style="font-size:14px;">San Diego Solar Installs</b><br>
  <span style="font-size:11px; color:#666;">n = {total} &nbsp;|&nbsp;
    Residential: {res} &nbsp;|&nbsp; Commercial: {com}</span><br><br>
  <span style="color:#2ecc71; font-size:18px;">&#9679;</span> Residential<br>
  <span style="color:#e74c3c; font-size:18px;">&#9679;</span> Commercial<br><br>
  <span style="font-size:11px; color:#888;">Toggle layers via the top-right control.<br>
  Heatmap shows raw install density.<br>
  kW-weighted layer highlights capacity.</span>
</div>
""".format(total=len(df), res=len(res_df), com=len(com_df))

m.get_root().html.add_child(folium.Element(legend_html))

# -----------------------------
# layer control + save
# -----------------------------
folium.LayerControl(collapsed=False).add_to(m)

output_path = "zenpower_map.html"
m.save(output_path)
print(f"Map saved to {output_path}")
print(f"Total installs: {len(df)}  |  Residential: {len(res_df)}  |  Commercial: {len(com_df)}")
