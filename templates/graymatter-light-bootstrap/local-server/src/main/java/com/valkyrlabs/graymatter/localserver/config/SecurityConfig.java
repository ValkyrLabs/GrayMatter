package com.valkyrlabs.graymatter.localserver.config;

import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/", "/index.html", "/favicon.ico", "/assets/**", "/actuator/health", "/actuator/info").permitAll()
                .requestMatchers("/api/**", "/MemoryEntry/**", "/Workbook/**").authenticated()
                .anyRequest().permitAll())
            .httpBasic(Customizer.withDefaults())
            .formLogin(form -> form.disable())
            .logout(logout -> logout.disable())
            .build();
    }

    @Bean
    UserDetailsService userDetailsService(PrincipalRecordRepository principalRecords) {
        return username -> principalRecords.findByUsernameIgnoreCase(username)
            .map(this::toUserDetails)
            .orElseThrow(() -> new UsernameNotFoundException("Principal not found: " + username));
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    private org.springframework.security.core.userdetails.UserDetails toUserDetails(PrincipalRecord principal) {
        return User.withUsername(principal.getUsername())
            .password(principal.getPasswordHash())
            .disabled(!principal.isEnabled())
            .authorities(principal.authorityArray())
            .build();
    }
}
