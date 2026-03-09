using System.Security.Claims;
using DocumentIntelligence.Application;
using DocumentIntelligence.Domain;
using MediatR;
using Microsoft.AspNetCore.Authorization;

namespace DocumentIntelligence.Api;

public record CreateTenantInviteRequest(string Email, UserRole Role);

public static class TenantEndpoints
{
    public static IEndpointRouteBuilder MapTenant(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/tenant")
            .RequireAuthorization("TenantUser");

        group.MapGet("/members", async (
            ClaimsPrincipal user,
            IMediator mediator,
            CancellationToken ct) =>
        {
            var tenantId = user.GetTenantId();
            if (tenantId == null)
                return Results.Unauthorized();

            var result = await mediator.Send(new GetTenantMembersQuery(tenantId.Value), ct);
            return Results.Ok(result);
        });

        group.MapPost("/invitations", async (
            CreateTenantInviteRequest request,
            ClaimsPrincipal user,
            IMediator mediator,
            CancellationToken ct) =>
        {
            var tenantId = user.GetTenantId();
            if (tenantId == null)
                return Results.Unauthorized();

            var tenantUserRole = user.GetRole();
            if (!string.Equals(tenantUserRole, UserRole.Owner.ToString(), StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(tenantUserRole, UserRole.Admin.ToString(), StringComparison.OrdinalIgnoreCase))
            {
                return Results.Forbid();
            }

            var code = await mediator.Send(new CreateTenantInviteCommand(tenantId.Value, request.Email, request.Role), ct);
            return Results.Ok(new { code });
        });

        return routes;
    }
}

