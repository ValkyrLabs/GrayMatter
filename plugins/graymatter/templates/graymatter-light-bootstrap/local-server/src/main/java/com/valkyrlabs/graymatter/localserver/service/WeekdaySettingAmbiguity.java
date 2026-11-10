package com.valkyrlabs.graymatter.localserver.service;

import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.service.MemoryHybridSearchService.SearchHit;
import java.time.DayOfWeek;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Competing standalone weekday assignments can require clarification without establishing either as false. */
final class WeekdaySettingAmbiguity {
    private static final String SUBJECT = "((?:[a-z0-9][a-z0-9-]{0,31} ){1,5}"
        + "(?:window|deadline|cutoff|meeting|appointment|handoff|launch|release|deployment))";
    private static final Pattern QUESTION = Pattern.compile(
        "(?:(?:when|(?:what|which) (?:weekday|day(?: of the week)?)) is )?(?:the )?" + SUBJECT + "[?]?");
    private static final String DAY = "(monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
    private static final Pattern ASSIGNMENT = Pattern.compile("(?:the )?" + SUBJECT + " is (?:on )?" + DAY + "[.]?");
    private static final Pattern WEEKLY_SCHEDULE = Pattern.compile("(?:the )?" + SUBJECT
        + " (?:runs|occurs|repeats|is) on (?:both )?" + DAY + " and " + DAY + " (?:each|every) week[.]?");

    private static final Pattern RELATIVE_OR_RECURRING = Pattern.compile(
        "\\b(?:next|last|this|that|previous|upcoming|current|every|each|both|recurring|rotating|alternating"
        + "|daily|weekly|monthly|annually|yearly|sometimes|usually|occasionally)\\b");
    private static final Pattern SPACING = Pattern.compile("[ \\t]+");

    private WeekdaySettingAmbiguity() {}

    static List<SearchHit> find(String query, List<SearchHit> selected, List<SearchHit> remaining) {
        Matcher question = QUESTION.matcher(normalize(query));
        if (!question.matches()) return List.of();
        String subject = question.group(1);
        if (RELATIVE_OR_RECURRING.matcher(subject).find()) return List.of();
        // Only a complete, delivered ranking can resolve a pair with an explicit recurring schedule.
        Map<Scope, Set<DayOfWeek>> schedules = remaining.isEmpty() ? selectedSchedules(subject, selected) : Map.of();
        Map<Scope, Setting> selectedByScope = new HashMap<>();
        for (SearchHit hit : selected) {
            Setting setting = parse(hit, subject);
            if (setting == null) continue;
            Setting previous = selectedByScope.putIfAbsent(setting.scope(), setting);
            if (previous != null && previous.day() != setting.day()) {
                Set<DayOfWeek> schedule = schedules.getOrDefault(setting.scope(), Set.of());
                if (!schedule.contains(previous.day()) || !schedule.contains(setting.day())) return List.of(previous.hit(), hit);
            }
        }
        if (!selectedByScope.isEmpty()) {
            for (SearchHit hit : remaining) {
                Setting setting = parse(hit, subject);
                if (setting == null) continue;
                Setting previous = selectedByScope.get(setting.scope());
                if (previous != null && previous.day() != setting.day()) return List.of(previous.hit(), hit);
            }
        }
        return List.of();
    }

    private static Map<Scope, Set<DayOfWeek>> selectedSchedules(String subject, List<SearchHit> selected) {
        Map<Scope, Set<DayOfWeek>> schedules = new HashMap<>();
        for (SearchHit hit : selected) {
            Matcher schedule = match(hit.entry(), subject, WEEKLY_SCHEDULE);
            if (schedule == null) continue;
            DayOfWeek first = day(schedule.group(2));
            DayOfWeek second = day(schedule.group(3));
            if (first == second) continue;
            schedules.merge(scope(hit), Set.of(first, second),
                (left, right) -> left.equals(right) ? left : Set.of());
        }
        return schedules;
    }

    private static Setting parse(SearchHit hit, String subject) {
        Matcher assignment = match(hit.entry(), subject, ASSIGNMENT);
        return assignment == null ? null : new Setting(scope(hit), day(assignment.group(2)), hit);
    }

    private static Matcher match(MemoryEntry entry, String subject, Pattern syntax) {
        // Pack metadata and arbitrary tags can qualify a statement beyond its body text.
        if (entry.getText().length() > 256 || entry.getKnowledgePack() != null || entry.getSourceObjectId() != null
            || (entry.getTags() != null && !entry.getTags().isBlank())) return null;
        Matcher match = syntax.matcher(normalize(entry.getText()));
        return match.matches() && subject.equals(match.group(1)) ? match : null;
    }

    private static Scope scope(SearchHit hit) {
        return new Scope(hit.entry().getType(), hit.entry().getSourceChannel());
    }

    private static DayOfWeek day(String normalized) {
        return DayOfWeek.valueOf(normalized.toUpperCase(Locale.ROOT));
    }

    private static String normalize(String text) {
        return SPACING.matcher(text.strip().toLowerCase(Locale.ROOT)).replaceAll(" ");
    }

    private record Scope(String type, String sourceChannel) {}
    private record Setting(Scope scope, DayOfWeek day, SearchHit hit) {}
}
