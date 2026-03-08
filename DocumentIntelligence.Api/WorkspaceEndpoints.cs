using System.Security.Claims;
using DocumentIntelligence.Application;
using MediatR;
using Microsoft.AspNetCore.Authorization;

namespace DocumentIntelligence.Api;

public record CreateWorkspaceRequest(string Name, string? Description);

public static class WorkspaceEndpoints
{
    public static IEndpointRouteBuilder MapWorkspaces(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/workspaces")
            .RequireAuthorization("TenantUser");

        group.MapGet(string.Empty, async (ClaimsPrincipal user, IMediator mediator, CancellationToken ct) =>
        {
            var tenantIdClaim = user.FindFirst("tenantId")?.Value;
            if (!Guid.TryParse(tenantIdClaim, out var tenantId))
            {
                return Results.Unauthorized();
            }

            var result = await mediator.Send(new GetWorkspacesQuery(tenantId), ct);
            return Results.Ok(result);
        });

        group.MapPost(string.Empty, async (CreateWorkspaceRequest request, ClaimsPrincipal user, IMediator mediator, CancellationToken ct) =>
        {
            var tenantIdClaim = user.FindFirst("tenantId")?.Value;
            if (!Guid.TryParse(tenantIdClaim, out var tenantId))
                return Results.Unauthorized();

            var command = new CreateWorkspaceCommand(tenantId, request.Name, request.Description);
            var created = await mediator.Send(command, ct);
            return Results.Ok(created);
        })
        .RequireAuthorization("OwnerOrAdmin");

        return routes;
    }
}

