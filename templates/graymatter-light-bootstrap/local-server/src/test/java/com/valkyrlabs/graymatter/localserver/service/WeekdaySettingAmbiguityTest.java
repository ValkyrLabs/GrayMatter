package com.valkyrlabs.graymatter.localserver.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.service.MemoryHybridSearchService.SearchHit;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class WeekdaySettingAmbiguityTest {
    private static SearchHit hit(String text, String source, String tags) {
        return new SearchHit(new MemoryEntry(null, "decision", text, source, tags), 1, 0, 1, "KEYWORD", "hash");
    }

    private static SearchHit hit(String text) {
        return hit(text, "schedule", "");
    }

    @Test
    void exactQuerySubjectCanHaveTwoCompetingValuesWithinOrBelowTheSelection() {
        var first = hit("The release cutoff is Monday.");
        var second = hit("Release cutoff is on TUESDAY.");
        var same = hit("Release cutoff is on Monday");
        for (String query : List.of("release cutoff", "The release cutoff", "When is the release cutoff?",
                                    "Which day is the release cutoff?", "What day is release cutoff?",
                                    "What weekday is the release cutoff?", "Which day of the week is the release cutoff?")) {
            assertThat(WeekdaySettingAmbiguity.find(query, List.of(first, same, second), List.of())).containsExactly(first, second);
            assertThat(WeekdaySettingAmbiguity.find(query, List.of(first), List.of(same, second))).containsExactly(first, second);
            assertThat(WeekdaySettingAmbiguity.find(query, List.of(first, same), List.of())).isEmpty();
        }
        assertThat(WeekdaySettingAmbiguity.find("release", List.of(first, second), List.of())).isEmpty();
        assertThat(WeekdaySettingAmbiguity.find("billing cutoff", List.of(first, second), List.of())).isEmpty();
        assertThat(WeekdaySettingAmbiguity.find("release cutoff", List.of(hit("Notes about the release cutoff.")),
            List.of(first, second))).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "Canary window is on Wednesday.", "Canary window is Wed.", "Canary window is Wednesday and Thursday.",
        "Canary window is Wednesday through Thursday.", "Canary window starts Thursday.", "Canary window ends Thursday.",
        "Canary prep is Thursday.", "US canary window is Thursday.", "Staging canary window is Thursday.",
        "This week's canary window is Thursday.", "Canary window was Thursday.", "Canary window is not Thursday.",
        "Canary window is Thursday if Wednesday is a holiday.", "Canary window is Thursday. That was the old schedule.",
        "She said the canary window is Thursday.", "Wednesday and Thursday were discussed for the canary window."
    })
    void doesNotInferCompetingSettingsFromCompatibleQualifiedOrUnrelatedText(String other) {
        assertThat(WeekdaySettingAmbiguity.find("Canary window", List.of(hit("Canary window is Wednesday."), hit(other)),
            List.of())).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"next release", "this release", "weekly release window", "rotating release window"})
    void doesNotTreatRelativeOrRecurringLabelsAsOneTimeSlots(String subject) {
        assertThat(WeekdaySettingAmbiguity.find("When is the " + subject + "?",
            List.of(hit(subject + " is Monday."), hit(subject + " is Tuesday.")), List.of())).isEmpty();
    }

    @Test
    void onlyACompleteSameScopeWeeklyScheduleExplainsBothSelectedDays() {
        var first = hit("Release cutoff is Monday.");
        var second = hit("Release cutoff is Thursday.");
        var schedule = hit("The release cutoff occurs on Monday and Thursday every week.");
        assertThat(WeekdaySettingAmbiguity.find("release cutoff", List.of(first, second, schedule), List.of())).isEmpty();
        assertThat(WeekdaySettingAmbiguity.find("release cutoff", List.of(first, second), List.of(schedule)))
            .containsExactly(first, second);
        assertThat(WeekdaySettingAmbiguity.find("release cutoff", List.of(first, schedule), List.of(second)))
            .containsExactly(first, second);
        for (var unresolved : List.of(hit("Release cutoff runs on Monday and Tuesday every week."),
                                      hit("Release cutoff runs on Monday and Thursday every week.", "staging", ""),
                                      hit("Release cutoff runs on Monday and Thursday every week except in June."))) {
            assertThat(WeekdaySettingAmbiguity.find("release cutoff", List.of(first, second, unresolved), List.of()))
                .containsExactly(first, second);
        }
        assertThat(WeekdaySettingAmbiguity.find("release cutoff", List.of(first, second, schedule,
            hit("Release cutoff repeats on Monday and Tuesday every week.")), List.of())).containsExactly(first, second);
        var extra = hit("Release cutoff is Friday.");
        assertThat(WeekdaySettingAmbiguity.find("release cutoff", List.of(first, second, schedule, extra), List.of()))
            .containsExactly(first, extra);
    }

    @Test
    void separateChannelsAndQualifyingTagsAreOutsideTheRule() {
        var first = hit("Canary window is Wednesday.");
        var differentSource = hit("Canary window is Thursday.", "staging", "");
        var qualified = hit("Canary window is Thursday.", "schedule", "fallback");
        assertThat(WeekdaySettingAmbiguity.find("Canary window", List.of(first), List.of(differentSource, qualified))).isEmpty();
    }
}
