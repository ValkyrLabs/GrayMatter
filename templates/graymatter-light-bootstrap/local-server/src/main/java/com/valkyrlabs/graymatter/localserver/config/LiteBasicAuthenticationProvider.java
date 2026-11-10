package com.valkyrlabs.graymatter.localserver.config;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.function.LongSupplier;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.password.PasswordEncoder;

/** Remembers only successful password comparisons. Spring still resolves and authorizes the account on every request. */
final class LiteBasicAuthenticationProvider extends DaoAuthenticationProvider {
    private static final String HMAC = "HmacSHA256";
    private final SecretKeySpec key;
    private final int capacity;
    private final long ttlNanos;
    private final LongSupplier clock;
    private final LinkedHashMap<Proof, Long> verified = new LinkedHashMap<>();

    LiteBasicAuthenticationProvider(UserDetailsService users, PasswordEncoder passwords, int capacity,
                                    long ttlNanos, LongSupplier clock) {
        super(passwords);
        setUserDetailsService(users);
        if (capacity < 1 || ttlNanos < 1) throw new IllegalArgumentException("Invalid credential proof cache bounds");
        this.capacity = capacity;
        this.ttlNanos = ttlNanos;
        this.clock = clock;
        byte[] secret = new byte[32];
        new SecureRandom().nextBytes(secret);
        this.key = new SecretKeySpec(secret, HMAC);
        Arrays.fill(secret, (byte) 0);
    }

    @Override
    protected void additionalAuthenticationChecks(UserDetails user, UsernamePasswordAuthenticationToken authentication) {
        Proof proof = authentication.getCredentials() instanceof String password ? proof(user, password) : null;
        if (proof != null && containsFresh(proof)) return;
        // Only the real-account comparison can admit a proof. The DAO's unknown-user timing check
        // calls the original encoder directly. Never hold the cache lock while running bcrypt.
        super.additionalAuthenticationChecks(user, authentication);
        if (proof != null) remember(proof);
    }

    private Proof proof(UserDetails user, String password) {
        // Legacy bcrypt matches may accept suffixes after the first 72 UTF-8 bytes. Always let
        // the original encoder verify those submissions, without turning aliases into cache entries.
        if (password.length() > 72 || user.getPassword() == null) return null;
        ByteBuffer bytes;
        try {
            bytes = StandardCharsets.UTF_8.newEncoder().encode(CharBuffer.wrap(password));
        } catch (CharacterCodingException malformed) {
            return null;
        }
        try {
            if (bytes.remaining() > 72) return null;
            Mac mac = Mac.getInstance(HMAC);
            mac.init(key);
            frame(mac, ByteBuffer.wrap(user.getUsername().getBytes(StandardCharsets.UTF_8)));
            frame(mac, ByteBuffer.wrap(user.getPassword().getBytes(StandardCharsets.UTF_8)));
            frame(mac, bytes);
            return new Proof(mac.doFinal());
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Cannot compute local credential proof", e);
        } finally {
            Arrays.fill(bytes.array(), (byte) 0);
        }
    }

    private static void frame(Mac mac, ByteBuffer bytes) {
        mac.update(ByteBuffer.allocate(Integer.BYTES).putInt(bytes.remaining()).array());
        mac.update(bytes);
    }

    private synchronized boolean containsFresh(Proof proof) {
        Long verifiedAt = verified.get(proof);
        if (verifiedAt == null) return false;
        if (clock.getAsLong() - verifiedAt < ttlNanos) return true;
        verified.remove(proof);
        return false;
    }

    private synchronized void remember(Proof proof) {
        verified.remove(proof);
        if (verified.size() >= capacity) verified.remove(verified.keySet().iterator().next());
        verified.put(proof, clock.getAsLong());
    }

    private record Proof(byte[] tag) {
        @Override public boolean equals(Object other) {
            return other instanceof Proof proof && MessageDigest.isEqual(tag, proof.tag);
        }
        @Override public int hashCode() { return Arrays.hashCode(tag); }
    }
}
