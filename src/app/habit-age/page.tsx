import PageHeader from "@/components/PageHeader";
import HabitAgeGame from "./HabitAgeGame";

export default function HabitAgePage() {
  return (
    <div>
      <PageHeader
        title="Habit Age"
        subtitle="How old are your habits? A free, fun quiz about everyday habits. Takes about a minute."
      />
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-10">
        <HabitAgeGame />
      </div>
    </div>
  );
}
