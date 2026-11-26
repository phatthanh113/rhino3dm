export function format_bytes(byte_count: number | null | undefined): string {
  if (!byte_count) {
    return "0 MB";
  }
  return `${(byte_count / 1024 ** 2).toFixed(1)} MB`;
}

export function format_number(value: number | null | undefined): string {
  if (!value) {
    return "0";
  }
  return value.toLocaleString("en-US");
}

export function format_date(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString("en-GB");
}

export function format_meters(value: number): string {
  return `${value.toFixed(1)} m`;
}

export type LengthUnit = "m" | "cm" | "mm" | "ft" | "in";

type UnitSpec = {
  id: LengthUnit;
  label: string;
  factor: number;
  digits: number;
};

export const LENGTH_UNITS: UnitSpec[] = [
  { id: "m", label: "m", factor: 1, digits: 2 },
  { id: "cm", label: "cm", factor: 100, digits: 1 },
  { id: "mm", label: "mm", factor: 1000, digits: 0 },
  { id: "ft", label: "ft", factor: 3.280839895, digits: 2 },
  { id: "in", label: "in", factor: 39.37007874, digits: 1 },
];

function unit_spec(unit: LengthUnit): UnitSpec {
  return LENGTH_UNITS.find((item) => item.id === unit) ?? LENGTH_UNITS[0];
}

export function format_length(meters: number, unit: LengthUnit): string {
  const spec = unit_spec(unit);
  return `${(meters * spec.factor).toFixed(spec.digits)} ${spec.label}`;
}

export function format_coordinates(
  point: [number, number, number],
  unit: LengthUnit,
): string {
  const spec = unit_spec(unit);
  const values = point.map((value) =>
    (value * spec.factor).toFixed(spec.digits),
  );
  return `${values.join(", ")} ${spec.label}`;
}
