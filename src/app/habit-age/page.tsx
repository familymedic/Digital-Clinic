import PageHeader from "@/components/PageHeader";
import HabitAgeGame from "./HabitAgeGame";

export default function HabitAgePage() {
  return (
    <div>
      <PageHeader
        title="Habit Age"
        subtitle="Do your habits agree with your age? A free, fun quiz about everyday habits. Takes about a minute."
      />
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-10">
        <HabitAgeGame />
      </div>
    </div>
  );
}
