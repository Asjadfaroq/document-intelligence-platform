using System.Security.Claims;
using DocumentIntelligence.Application;
using Microsoft.AspNetCore.Authorization;

namespace DocumentIntelligence.Api;

public static class AdminEndpoints
{
    public static IEndpointRouteBuilder MapAdmin(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/admin")
            .RequireAuthorization("OwnerOrAdmin");

        group.MapGet("/tenant/overview", async (
            ClaimsPrincipal user,
            ITenantOverviewProvider overviewProvider,
            CancellationToken ct) =>
        {
            var tenantId = user.GetTenantId();
            if (tenantId == null)
                return Results.Unauthorized();

            var overview = await overviewProvider.GetOverviewAsync(tenantId.Value, ct);
            return Results.Ok(overview);
        });

        return routes;
    }
}
