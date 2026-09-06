class ScanCapture:
    def __init__(self):
        self.measurements = []

    def add_measurement(self, angle, distance_cm):
        self.measurements.append({
            "angle": angle,
            "distance_cm": distance_cm
        })

    def get_scan(self):
        return self.measurements

    def clear(self):
        self.measurements = []


if __name__ == "__main__":
    scan = ScanCapture()

    scan.add_measurement(0, 80.0)
    scan.add_measurement(15, 75.5)
    scan.add_measurement(30, None)
    scan.add_measurement(45, 38.5)

    print(scan.get_scan())