using System.Security.Claims;
using DocumentIntelligence.Application;
using DocumentIntelligence.Domain;
using MediatR;
using Microsoft.AspNetCore.Authorization;

namespace DocumentIntelligence.Api;

public record CreateTenantInviteRequest(string Email, string Role);

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
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger("DocumentIntelligence.TenantInvites");
            var tenantId = user.GetTenantId();
            if (tenantId == null)
                return Results.Unauthorized();

            var tenantUserRole = user.GetRole();
            if (!string.Equals(tenantUserRole, UserRole.Owner.ToString(), StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(tenantUserRole, UserRole.Admin.ToString(), StringComparison.OrdinalIgnoreCase))
            {
                return Results.Forbid();
            }

            if (string.IsNullOrWhiteSpace(request.Role) ||
                !Enum.TryParse<UserRole>(request.Role, ignoreCase: true, out var inviteRole) ||
                inviteRole == UserRole.Owner)
            {
                return Results.BadRequest(new { title = "Role must be 'Member' or 'Admin'.", status = 400 });
            }

            try
            {
                var code = await mediator.Send(new CreateTenantInviteCommand(tenantId.Value, request.Email, inviteRole), ct);
                log.LogInformation("Invite created: TenantId={TenantId}, Email={Email}", tenantId, request.Email);
                return Results.Ok(new { code });
            }
            catch (InvalidOperationException ex)
            {
                log.LogWarning(ex, "Invite creation failed (validation): TenantId={TenantId}, Email={Email}", tenantId, request.Email);
                return Results.BadRequest(new { title = ex.Message, status = 400 });
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Invite creation failed (unexpected): TenantId={TenantId}, Email={Email}", tenantId, request.Email);
                return Results.Json(new { title = "Invite creation failed.", status = 500, detail = ex.Message }, statusCode: 500);
            }
        });

        return routes;
    }
}

