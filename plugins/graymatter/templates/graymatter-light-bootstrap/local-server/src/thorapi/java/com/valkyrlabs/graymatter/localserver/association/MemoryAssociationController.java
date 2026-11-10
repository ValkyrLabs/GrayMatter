package com.valkyrlabs.graymatter.localserver.association;

import java.security.Principal;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/v1/graymatter/memory/associations", produces = MediaType.APPLICATION_JSON_VALUE)
class MemoryAssociationController {
    private final MemoryAssociationService associations;
    private final AssociationConstraints constraints;

    MemoryAssociationController(MemoryAssociationService associations, AssociationConstraints constraints) {
        this.associations = associations;
        this.constraints = constraints;
    }

    @GetMapping("/capabilities")
    AssociationProtocol.Capability capabilities() {
        constraints.requireReady();
        return AssociationProtocol.CAPABILITY;
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<AssociationProtocol.Receipt> record(Principal principal, @RequestBody byte[] body) {
        var receipt = associations.record(principal.getName(), AssociationProtocol.parse(body));
        return ResponseEntity.status(receipt.replayed() ? HttpStatus.OK : HttpStatus.CREATED).body(receipt);
    }

    @GetMapping("/{associationRef}")
    AssociationProtocol.Receipt read(Principal principal, @PathVariable String associationRef) {
        return associations.read(principal.getName(), AssociationProtocol.uuid(associationRef));
    }
}
