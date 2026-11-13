import { AREA_GROUPS, SERVICE_CITIES } from "@/lib/locator";

// <option>s for an area <select>, grouped by city when there is more than one service city.
export default function AreaOptions({ withOther = false }: { withOther?: boolean }) {
  const many = AREA_GROUPS.length > 1;
  return (
    <>
      {AREA_GROUPS.map((g) =>
        many ? (
          <optgroup key={g.city} label={g.city}>
            {g.areas.map((a) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
          </optgroup>
        ) : (
          g.areas.map((a) => (
            <option key={a.name} value={a.name}>{a.name}</option>
          ))
        )
      )}
      {withOther && <option value="Other area">{`Other area of ${SERVICE_CITIES.join(" / ")}`}</option>}
    </>
  );
}
