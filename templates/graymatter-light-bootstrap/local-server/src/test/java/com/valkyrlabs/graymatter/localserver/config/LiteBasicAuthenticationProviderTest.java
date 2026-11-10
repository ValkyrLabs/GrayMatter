package com.valkyrlabs.graymatter.localserver.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

class LiteBasicAuthenticationProviderTest {
    private final AtomicLong time = new AtomicLong();
    private final AtomicInteger lookups = new AtomicInteger();
    private final CountedBCrypt bcrypt = new CountedBCrypt();

    @Test
    void expiryIsFixedCapacityIsBoundedAndDatabaseIdentityIsReloadedEvenOnHits() {
        String hash = bcrypt.encode("same");
        var manager = manager(Map.of("alpha", hash, "beta", hash, "gamma", hash), 2);
        assertThat(auth(manager, "alpha", "same").getCredentials()).isNull();
        time.set(9);
        auth(manager, "alpha", "same");
        assertThat(bcrypt.matches.get()).isEqualTo(1);
        time.set(10);
        auth(manager, "alpha", "same");
        assertThat(bcrypt.matches.get()).isEqualTo(2);
        auth(manager, "beta", "same");
        auth(manager, "gamma", "same");
        auth(manager, "alpha", "same");
        assertThat(bcrypt.matches.get()).isEqualTo(5);
        assertThat(lookups.get()).isEqualTo(6);
    }

    @Test
    void failuresAndDummyMitigationAlwaysReachBCrypt() {
        var manager = manager(Map.of("actual", bcrypt.encode("correct")), 4);
        for (String guess : new String[]{"wrong", "wrong"}) {
            assertThatThrownBy(() -> auth(manager, "actual", guess)).isInstanceOf(BadCredentialsException.class);
        }
        String sentinel = "userNotFoundPassword";
        for (String guess : new String[]{sentinel, sentinel, sentinel + "\0" + sentinel, sentinel + "\0" + sentinel}) {
            assertThatThrownBy(() -> auth(manager, "absent", guess)).isInstanceOf(BadCredentialsException.class);
        }
        assertThat(bcrypt.matches.get()).isEqualTo(6);
        assertThat(lookups.get()).isEqualTo(6);
    }

    @Test
    void valid72BytePasswordsCacheButLongerBCryptAliasesAlwaysRequireOriginalComparison() {
        String prefix = "é".repeat(36);
        var manager = manager(Map.of("fixture", bcrypt.encode(prefix)), 4);
        auth(manager, "fixture", prefix);
        auth(manager, "fixture", prefix);
        assertThat(bcrypt.matches.get()).isEqualTo(1);
        // 37 Java characters, 73 UTF-8 bytes. Spring Security's existing BCrypt verifier accepts this prefix alias.
        for (String suffix : new String[]{"x", "x", "another suffix"}) auth(manager, "fixture", prefix + suffix);
        assertThat(bcrypt.matches.get()).isEqualTo(4);
        assertThatThrownBy(() -> auth(manager, "fixture", "wrong" + prefix)).isInstanceOf(BadCredentialsException.class);
        auth(manager, "fixture", prefix);
        assertThat(bcrypt.matches.get()).isEqualTo(5);
    }

    @Test
    void embeddedNulAliasesMustProveTheirOwnExactBytes() {
        var manager = manager(Map.of("fixture", bcrypt.encode("word")), 4);
        auth(manager, "fixture", "word");
        auth(manager, "fixture", "word\0word");
        auth(manager, "fixture", "word\0word");
        assertThat(bcrypt.matches.get()).isEqualTo(2);
    }

    private ProviderManager manager(Map<String, String> hashes, int capacity) {
        UserDetailsService users = name -> {
            lookups.incrementAndGet();
            if (!hashes.containsKey(name)) throw new UsernameNotFoundException("not found");
            return User.withUsername(name).password(hashes.get(name)).roles("USER").build();
        };
        return new ProviderManager(new LiteBasicAuthenticationProvider(users, bcrypt, capacity, 10, time::get));
    }

    private static Authentication auth(ProviderManager manager, String user, String password) {
        return manager.authenticate(UsernamePasswordAuthenticationToken.unauthenticated(user, password));
    }

    private static final class CountedBCrypt extends BCryptPasswordEncoder {
        final AtomicInteger matches = new AtomicInteger();

        CountedBCrypt() { super(4); }

        @Override public boolean matches(CharSequence rawPassword, String encodedPassword) {
            matches.incrementAndGet();
            return super.matches(rawPassword, encodedPassword);
        }
    }
}
