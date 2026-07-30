using System.Text.Json;
using Awake.Application.Common.Interfaces;
using Awake.Application.Common.Interfaces.Repositories;
using Awake.Application.Common.Models;
using Awake.Domain.Entities;
using Awake.Domain.Enums;
using MediatR;

namespace Awake.Application.Features.Maps.Commands.SaveMapLayout;

public class SaveMapLayoutCommandHandler(
    IMapLayoutRepository layouts,
    IMapAssetService mapAssets,
    ICurrentUserService currentUser)
    : IRequestHandler<SaveMapLayoutCommand, Result<MapLayoutDto>>
{
    private const int MaxProps = 2000;
    private const int MaxPropsLength = 512 * 1024;

    public async Task<Result<MapLayoutDto>> Handle(
        SaveMapLayoutCommand request, CancellationToken cancellationToken)
    {
        if (!mapAssets.IsKnownLocation(request.Location))
            return Result<MapLayoutDto>.Failure("Неизвестная локация.");

        var name = request.Name.Trim();
        if (name.Length is 0 or > 80)
            return Result<MapLayoutDto>.Failure("Название должно быть от 1 до 80 символов.");

        var propsError = Validate(request.Props);
        if (propsError is not null)
            return Result<MapLayoutDto>.Failure(propsError);

        var existing = (await layouts.GetByLocationAsync(request.Location, cancellationToken))
            .FirstOrDefault(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));

        if (existing is not null)
        {
            // Чужую расстановку правит только полковник и выше: иначе любой
            // Member мог бы молча переписать чужую подготовку к войне.
            if (existing.AuthorId != currentUser.UserId && currentUser.Rank < UserRank.Colonel)
                return Result<MapLayoutDto>.Failure("Эту расстановку может изменить только её автор.");

            existing.Props = request.Props;
            existing.UpdatedAt = DateTime.UtcNow;
            await layouts.UpdateAsync(existing, cancellationToken);
            return Result<MapLayoutDto>.Success(ToDto(existing));
        }

        var layout = new MapLayout
        {
            Location = request.Location,
            Name = name,
            Props = request.Props,
            AuthorId = currentUser.UserId,
        };
        await layouts.AddAsync(layout, cancellationToken);

        return Result<MapLayoutDto>.Success(ToDto(layout));
    }

    /// <summary>
    /// Расстановка приходит с клиента и уходит в jsonb, поэтому проверяется до
    /// записи: и на разбираемость, и на размер — иначе один запрос может
    /// положить в базу мегабайты мусора.
    /// </summary>
    private static string? Validate(string props)
    {
        if (props.Length > MaxPropsLength)
            return "Расстановка слишком большая.";

        try
        {
            using var document = JsonDocument.Parse(props);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
                return "Расстановка должна быть массивом объектов.";
            if (document.RootElement.GetArrayLength() > MaxProps)
                return $"В расстановке не больше {MaxProps} объектов.";
        }
        catch (JsonException)
        {
            return "Расстановка повреждена.";
        }

        return null;
    }

    private static MapLayoutDto ToDto(MapLayout layout) => new(
        layout.Id,
        layout.Location,
        layout.Name,
        layout.Props,
        layout.AuthorId,
        layout.Author?.Username ?? "—",
        layout.CreatedAt,
        layout.UpdatedAt);
}
