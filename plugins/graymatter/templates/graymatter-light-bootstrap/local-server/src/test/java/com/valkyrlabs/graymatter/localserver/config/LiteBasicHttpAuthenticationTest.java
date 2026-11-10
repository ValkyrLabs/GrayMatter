package com.valkyrlabs.graymatter.localserver.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestComponent;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "server.address=127.0.0.1",
    "spring.datasource.url=jdbc:h2:mem:credential-proof-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=create-drop", "graymatter.starter-knowledge-pack.enabled=false"
})
@Import(LiteBasicHttpAuthenticationTest.AuthorityView.class)
class LiteBasicHttpAuthenticationTest {
    @LocalServerPort int port;
    @Autowired PasswordEncoder passwords;
    @Autowired PrincipalRecordRepository principals;
    @Autowired JdbcTemplate jdbc;
    private final HttpClient client = HttpClient.newBuilder()
        .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build();

    @Test
    void aWarmBasicPasswordNeverCarriesLoginOrAuthoritiesAcrossRequests() throws Exception {
        String old = "fixture-password";
        String fresh = "new-fixture-password";
        String hash = passwords.encode(old);
        var user = principals.save(new PrincipalRecord("fixture", hash, "Fixture", "ROLE_OPERATOR"));
        var shadow = principals.save(new PrincipalRecord("shadow", hash, "Shadow", "ROLE_READER"));
        jdbc.update("update principal set enabled=false where id=?", shadow.getId());
        assertThat(request("fixture", old).body()).contains("ROLE_OPERATOR");
        assertThat(request("fixture", old).body()).contains("ROLE_OPERATOR");
        assertThat(request(null, null).statusCode()).isEqualTo(401);
        assertThat(request("shadow", old).statusCode()).isEqualTo(401);
        assertThat(request("fixture", "wrong").statusCode()).isEqualTo(401);

        jdbc.update("update principal set roles='ROLE_READER' where id=?", user.getId());
        var changedRole = request("fixture", old);
        assertThat(changedRole.statusCode()).isEqualTo(200);
        assertThat(changedRole.body()).contains("ROLE_READER").doesNotContain("ROLE_OPERATOR");
        jdbc.update("update principal set enabled=false where id=?", user.getId());
        assertThat(request("fixture", old).statusCode()).isEqualTo(401);
        jdbc.update("update principal set enabled=true where id=?", user.getId());
        assertThat(request("fixture", old).statusCode()).isEqualTo(200);
        jdbc.update("update principal set password_hash=? where id=?", passwords.encode(fresh), user.getId());
        assertThat(request("fixture", old).statusCode()).isEqualTo(401);
        assertThat(request("fixture", fresh).statusCode()).isEqualTo(200);
        principals.deleteById(user.getId());
        assertThat(request("fixture", fresh).statusCode()).isEqualTo(401);
    }

    private HttpResponse<String> request(String name, String password) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/v1/test/effective-authorities"));
        if (name != null) {
            String basic = Base64.getEncoder().encodeToString((name + ":" + password).getBytes(StandardCharsets.UTF_8));
            request.header("Authorization", "Basic " + basic);
        }
        return client.send(request.GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    @TestComponent
    @RestController
    static class AuthorityView {
        @GetMapping("/v1/test/effective-authorities")
        List<String> effectiveAuthorities(Authentication actual) {
            return actual.getAuthorities().stream().map(GrantedAuthority::getAuthority).toList();
        }
    }
}
