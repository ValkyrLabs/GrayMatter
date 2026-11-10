package com.valkyrlabs.graymatter.localserver.association;

import com.valkyrlabs.graymatter.generated.model.MemoryAssociation;
import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import jakarta.persistence.EntityManagerFactory;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import org.hibernate.engine.spi.SessionFactoryImplementor;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
class AssociationConstraints implements InitializingBean {
    private final JdbcTemplate jdbc;
    private final List<String> mappedTables;

    // Hibernate creates the generated scalar association table before installing these cross-model keys.
    AssociationConstraints(JdbcTemplate jdbc, EntityManagerFactory initializedJpa) {
        this.jdbc = jdbc;
        var mapping = initializedJpa.unwrap(SessionFactoryImplementor.class).getMappingMetamodel();
        this.mappedTables = List.of(
            mapping.getEntityDescriptor(MemoryAssociation.class).getMappedTableDetails().getTableName(),
            mapping.getEntityDescriptor(MemoryEntry.class).getMappedTableDetails().getTableName());
    }

    @Override
    public void afterPropertiesSet() {
        requireLocalMapping();
        jdbc.execute("alter table memory_association add constraint if not exists fk_memassoc_from "
            + "foreign key (from_id) references memory_entry(id) on delete cascade");
        jdbc.execute("alter table memory_association add constraint if not exists fk_memassoc_to "
            + "foreign key (to_id) references memory_entry(id) on delete cascade");
        requireReady();
    }

    void requireReady() {
        requireLocalMapping();
        boolean ready = Boolean.TRUE.equals(jdbc.execute((ConnectionCallback<Boolean>) this::ready));
        if (!ready) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Memory association storage unavailable");
    }

    private void requireLocalMapping() {
        // Inspect the actual Hibernate mapping before letting default-schema JDBC metadata attest storage.
        // Qualified or overridden mappings need an adapter that verifies their own namespace.
        if (!mappedTables.equals(List.of("memory_association", "memory_entry"))) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Unsupported memory association table mapping");
        }
    }

    private boolean ready(Connection connection) throws SQLException {
        DatabaseMetaData metadata = connection.getMetaData();
        String catalog = connection.getCatalog();
        String schema = connection.getSchema();
        String table = metadata.storesUpperCaseIdentifiers() ? "MEMORY_ASSOCIATION" : "memory_association";
        Map<String, List<String>> keys = new HashMap<>();
        try (ResultSet rs = metadata.getImportedKeys(catalog, schema, table)) {
            while (rs.next()) {
                String name = rs.getString("FK_NAME").toLowerCase(Locale.ROOT);
                boolean valid = Objects.equals(catalog, rs.getString("PKTABLE_CAT"))
                    && Objects.equals(schema, rs.getString("PKTABLE_SCHEM"))
                    && Objects.equals(catalog, rs.getString("FKTABLE_CAT"))
                    && Objects.equals(schema, rs.getString("FKTABLE_SCHEM"))
                    && table.equals(rs.getString("FKTABLE_NAME"))
                    && "memory_entry".equalsIgnoreCase(rs.getString("PKTABLE_NAME"))
                    && "id".equalsIgnoreCase(rs.getString("PKCOLUMN_NAME"))
                    && rs.getShort("KEY_SEQ") == 1
                    && rs.getShort("DELETE_RULE") == DatabaseMetaData.importedKeyCascade;
                keys.computeIfAbsent(name, unused -> new ArrayList<>())
                    .add(valid ? rs.getString("FKCOLUMN_NAME").toLowerCase(Locale.ROOT) : "");
            }
        }
        if (!List.of("from_id").equals(keys.get("fk_memassoc_from"))
            || !List.of("to_id").equals(keys.get("fk_memassoc_to"))) return false;

        Map<String, List<String>> uniqueIndexes = new HashMap<>();
        try (ResultSet rs = metadata.getIndexInfo(catalog, schema, table, true, false)) {
            while (rs.next()) {
                if (rs.getShort("TYPE") == DatabaseMetaData.tableIndexStatistic || rs.getBoolean("NON_UNIQUE")) continue;
                String column = rs.getString("COLUMN_NAME");
                boolean sameTable = Objects.equals(catalog, rs.getString("TABLE_CAT"))
                    && Objects.equals(schema, rs.getString("TABLE_SCHEM")) && table.equals(rs.getString("TABLE_NAME"));
                uniqueIndexes.computeIfAbsent(rs.getString("INDEX_NAME"), unused -> new ArrayList<>())
                    .add(sameTable && column != null && rs.getString("FILTER_CONDITION") == null
                        ? column.toLowerCase(Locale.ROOT) : "");
            }
        }
        return uniqueIndexes.containsValue(List.of("write_key_hash"));
    }
}
