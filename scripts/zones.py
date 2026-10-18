"""Assign a point to the game zone (regio, subzona) of its nearest unit base."""
import json, math

class Zones:
    def __init__(self, units_path):
        self.units = [u for u in json.load(open(units_path)) if u['tipus'] != 'HELI']

    def nearest(self, lat, lon):
        k = math.cos(math.radians(lat))
        u = min(self.units, key=lambda u: (u['base']['lat'] - lat) ** 2 + ((u['base']['lon'] - lon) * k) ** 2)
        return u['regio'], u['subzona']
